import { getManager, messageFor, supabase } from "./supabase-client.js";
import { graphPageUrl, parseDesmosGraph } from "./graph-utils.js";

const $ = selector => document.querySelector(selector);
const form = $("#graph-form");
const fields = form.elements;
const editor = $("#graph-editor");
const list = $("#admin-graphs-list");
const store = () => supabase.storage.from("graph-thumbnails");
let editing = null;
let imported = null;
let savedCover = "";
let customFile = null;
let customPreview = "";
let busy = false;

function message(text = "", error = false) {
  $("#graph-form-message").textContent = text;
  $("#graph-form-message").classList.toggle("is-error", error);
}

function setBusy(value) {
  busy = value;
  for (const element of form.elements) element.disabled = value;
  $("#cancel-edit").disabled = value;
  $("#new-graph").disabled = value;
  for (const button of list.querySelectorAll("button")) button.disabled = value;
}

function currentUrl() {
  try { return parseDesmosGraph(fields.source.value).url; } catch { return ""; }
}

function renderCover() {
  const automatic = fields.coverSource.value === "automatic";
  $("#custom-cover-field").hidden = automatic;
  const matchesImport = imported?.url === currentUrl();
  const matchesSaved = editing?.desmos_url === currentUrl();
  const url = automatic
    ? (matchesImport ? imported.thumbnail : (matchesSaved && editing?.thumbnail_source === "automatic" ? savedCover : ""))
    : (customPreview || (editing?.thumbnail_source === "custom" ? savedCover : ""));
  $("#cover-preview").hidden = !url;
  $("#cover-image").src = url || "";
  $("#cover-caption").textContent = automatic ? "Automatic preview from the saved Desmos graph" : "Custom cover image";
}

function renderGraph(url) {
  const holder = $("#admin-graph-preview");
  holder.replaceChildren();
  holder.hidden = !url;
  if (!url) return;
  const frame = document.createElement("iframe");
  frame.src = parseDesmosGraph(url).embedUrl;
  frame.title = "Interactive preview of the imported graph";
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
  holder.append(frame);
}

function releaseCustom() {
  if (customPreview) URL.revokeObjectURL(customPreview);
  customPreview = "";
  customFile = null;
}

async function openEditor(row = null) {
  editing = row;
  imported = null;
  savedCover = "";
  releaseCustom();
  form.reset();
  fields.title.value = row?.title || "";
  fields.year.value = row?.year || new Date().getFullYear();
  fields.description.value = row?.description || "";
  fields.source.value = row?.desmos_url || "";
  fields.status.value = row?.status || "draft";
  fields.coverSource.value = row?.thumbnail_source || "automatic";
  $("#editor-mode").textContent = row ? "Edit graph" : "New graph";
  $("#import-message").textContent = "";
  message();
  editor.hidden = false;
  renderGraph(row?.desmos_url);
  renderCover();
  editor.scrollIntoView({ behavior: "smooth", block: "start" });
  fields.source.focus({ preventScroll: true });
  if (row?.thumbnail_path) {
    const { data } = await store().createSignedUrl(row.thumbnail_path, 3600);
    if (editing !== row) return;
    savedCover = data?.signedUrl || "";
    renderCover();
  }
}

function closeEditor() {
  if (busy) return;
  editor.hidden = true;
  editing = null;
  imported = null;
  releaseCustom();
  renderGraph();
}

async function importSource() {
  const parsed = parseDesmosGraph(fields.source.value);
  $("#import-message").textContent = "Importing your graph and its preview…";
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Your session has ended. Sign in again to import a graph.");
  const response = await fetch("/api/graphs/import", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ source: parsed.url }),
    signal: AbortSignal.timeout(35000)
  });
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); } catch { throw new Error("The graph importer is unavailable. Please try again shortly."); }
  if (!response.ok) throw new Error(result.error || "The graph could not be imported.");
  if (result.url !== parsed.url || !/^data:image\/png;base64,/.test(result.thumbnail)) throw new Error("The graph importer returned an invalid preview.");
  imported = result;
  fields.source.value = result.url;
  if (!fields.title.value.trim()) fields.title.value = (result.title || "Untitled graph").slice(0, 120);
  $("#import-message").textContent = "Graph imported. Review the details below, then save.";
  renderGraph(result.url);
  renderCover();
  return result;
}

async function loadList() {
  const { data, error } = await supabase.from("graphs").select("*").order("updated_at", { ascending: false }).order("id", { ascending: false });
  if (error) throw error;
  const cards = await Promise.all(data.map(async row => {
    const article = document.createElement("article");
    article.className = "admin-graph-card";
    if (row.thumbnail_path) {
      const { data: cover } = await store().createSignedUrl(row.thumbnail_path, 3600);
      if (cover?.signedUrl) {
        const image = document.createElement("img");
        image.src = cover.signedUrl;
        image.alt = "";
        image.loading = "lazy";
        article.append(image);
      }
    }
    const body = document.createElement("div");
    const meta = document.createElement("small");
    meta.textContent = `${row.year} / ${row.status === "published" ? "Published" : "Draft"}`;
    const heading = document.createElement("h3");
    heading.textContent = row.title;
    const copy = document.createElement("p");
    copy.textContent = row.description;
    body.append(meta, heading, copy);
    const actions = document.createElement("div");
    actions.className = "admin-graph-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => { if (!busy) openEditor(row).catch(error => message(messageFor(error), true)); });
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = row.status === "published" ? "Unpublish" : "Publish";
    toggle.addEventListener("click", () => mutate(async () => {
      if (!row.thumbnail_path) throw new Error("Edit this draft and add a cover before publishing.");
      const { error } = await supabase.from("graphs").update({ status: row.status === "published" ? "draft" : "published" }).eq("id", row.id);
      if (error) throw error;
    }));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      if (!confirm(`Delete “${row.title}” from Room310? The original graph on Desmos will not be changed.`)) return;
      mutate(async () => {
        const { error } = await supabase.from("graphs").delete().eq("id", row.id);
        if (error) throw error;
        if (row.thumbnail_path) await store().remove([row.thumbnail_path]);
      });
    });
    actions.append(edit, toggle);
    if (row.status === "published") {
      const view = document.createElement("a");
      view.href = graphPageUrl(row.slug);
      view.textContent = "View graph ↗";
      actions.append(view);
    }
    actions.append(remove);
    article.append(body, actions);
    return article;
  }));
  if (cards.length) list.replaceChildren(...cards);
  else { const empty = document.createElement("p"); empty.textContent = "No graphs yet. Choose Add graph to get started."; list.replaceChildren(empty); }
}

async function mutate(action) {
  if (busy) return;
  setBusy(true);
  try { await action(); await loadList(); }
  catch (error) { alert(messageFor(error)); }
  finally { setBusy(false); }
}

async function save(event) {
  event.preventDefault();
  if (busy) return;
  setBusy(true);
  message("Saving graph…");
  let newPath = "";
  let committed = false;
  try {
    const url = parseDesmosGraph(fields.source.value).url;
    const source = fields.coverSource.value;
    let file = null;
    if (source === "automatic") {
      if (imported?.url !== url && (!editing?.thumbnail_path || editing.desmos_url !== url || editing.thumbnail_source !== "automatic")) await importSource();
      if (imported?.url === url) file = new File([await (await fetch(imported.thumbnail)).blob()], "graph.png", { type: "image/png" });
    } else {
      file = customFile;
      if (!file && !(editing?.thumbnail_path && editing.thumbnail_source === "custom")) throw new Error("Choose a custom cover image, or switch to Automatic graph preview.");
    }
    const details = { title: fields.title.value.trim(), description: fields.description.value.trim(), year: Number(fields.year.value), desmos_url: url };
    if (details.title.length < 2) throw new Error("Give the graph a title of at least two characters.");
    if (!editing) {
      const slug = `${details.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "graph"}-${crypto.randomUUID().slice(0, 8)}`;
      const { data, error } = await supabase.from("graphs").insert({ ...details, slug, status: "draft" }).select().single();
      if (error) throw error;
      editing = data;
    }
    if (file) {
      const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" }[file.type];
      newPath = `${editing.id}/cover-${crypto.randomUUID()}.${extension}`;
      const { error } = await store().upload(newPath, file, { contentType: file.type, upsert: false });
      if (error) throw error;
    }
    const oldPath = editing.thumbnail_path;
    const { error } = await supabase.from("graphs").update({ ...details, thumbnail_path: newPath || oldPath, thumbnail_source: source, status: fields.status.value }).eq("id", editing.id).select("id").single();
    if (error) throw error;
    committed = true;
    if (newPath && oldPath) await store().remove([oldPath]);
    setBusy(false);
    closeEditor();
    await loadList();
  } catch (error) {
    // Keep an uploaded cover on an uncertain network failure: the update may have committed.
    message(messageFor(error), true);
    $("#import-message").textContent = "";
    if (committed) alert("Your graph was saved, but the list could not refresh. Reload this page to see it.");
  } finally { setBusy(false); }
}

$("#new-graph").addEventListener("click", () => openEditor());
$("#cancel-edit").addEventListener("click", closeEditor);
$("#cancel-edit-bottom").addEventListener("click", closeEditor);
$("#import-graph").addEventListener("click", async () => {
  if (busy) return;
  setBusy(true);
  message();
  try { await importSource(); } catch (error) { $("#import-message").textContent = messageFor(error); }
  finally { setBusy(false); }
});
fields.source.addEventListener("input", () => { renderCover(); renderGraph(); $("#import-message").textContent = ""; });
fields.coverSource.addEventListener("change", renderCover);
fields.thumbnail.addEventListener("change", async () => {
  releaseCustom();
  const file = fields.thumbnail.files[0];
  if (file) {
    try {
      if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error("Choose a PNG, JPEG, GIF, or WebP image smaller than 5 MB.");
      const preview = URL.createObjectURL(file);
      const image = new Image();
      image.src = preview;
      try { await image.decode(); } catch { URL.revokeObjectURL(preview); throw new Error("This image could not be read. Choose another cover."); }
      // Ignore a decode that finished after the user changed files or closed the editor.
      if (fields.thumbnail.files[0] !== file || editor.hidden) { URL.revokeObjectURL(preview); return; }
      customFile = file;
      customPreview = preview;
      message();
    } catch (error) { fields.thumbnail.value = ""; message(messageFor(error), true); }
  }
  renderCover();
});
form.addEventListener("submit", save);
$("#admin-logout").addEventListener("click", async () => {
  if (busy) return;
  await supabase.auth.signOut();
  location.assign("/admin/login?next=%2Fadmin%2Fgraphs");
});

async function start() {
  const manager = await getManager();
  if (!manager) { location.replace("/admin/login?next=%2Fadmin%2Fgraphs"); return; }
  $("#admin-user").textContent = manager.profile.display_name || manager.user.email;
  await loadList();
  $("#new-graph").disabled = false;
}
start().catch(error => { list.textContent = messageFor(error); });
