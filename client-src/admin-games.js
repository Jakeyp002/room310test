import { configurationMessage, getManager, isConfigured, messageFor, projectUrl, publishableKey, supabase } from "./supabase-client.js";
import { renderSandboxedGame } from "./embed-runner.js";
import { gameFromRow, slugify, thumbnailExtension, validateEmbedHtml } from "./game-utils.js";
import { coverTransform } from "./image-crop-utils.js";
import { loadStandaloneHtml, prepareStandaloneFile, scanStandaloneHtml } from "./standalone-game.js";
import { uploadStandaloneTus } from "./tus-upload.js";

const list = document.querySelector("#admin-games-list");
const collectionList = document.querySelector("#admin-collections-list");
const editor = document.querySelector("#game-editor");
const form = document.querySelector("#game-form");
const message = document.querySelector("#game-form-message");
const hostType = form.elements.hostType;
const statusSelect = form.elements.status;
const embedPreview = document.querySelector("#embed-preview");
const embedPreviewViewport = document.querySelector("#embed-preview-viewport");
const standalonePreview = document.querySelector("#standalone-preview");
const standalonePreviewViewport = document.querySelector("#standalone-preview-viewport");
const standaloneScan = document.querySelector("#standalone-scan");
const standaloneSummary = document.querySelector("#standalone-file-summary");
const standaloneProgress = document.querySelector("#standalone-upload-progress");
let games = [];
let collections = [];
let editing = null;
let croppedThumbnail = null;
let thumbnailPreviewUrl = "";
let preparedStandalone = null;
let previewedStandaloneSha = "";

const cropper = document.querySelector("#thumbnail-cropper");
const cropCanvas = cropper.querySelector("canvas");
const cropContext = cropCanvas.getContext("2d", { alpha: false });
const cropZoom = cropper.querySelector("#crop-zoom");
const cropPreview = document.querySelector("#thumbnail-crop-preview");
const thumbnailInput = form.elements.thumbnail;
const cropState = { image: null, offsetX: 0, offsetY: 0, zoom: 1, dragging: false, pointerX: 0, pointerY: 0 };

function showFormMessage(text, state = "error") {
  message.textContent = text;
  message.dataset.state = state;
}

function uniquePath(id, prefix, extension) {
  return `${id}/${prefix}-${crypto.randomUUID()}.${extension}`;
}

function clearThumbnailDraft() {
  croppedThumbnail = null;
  thumbnailInput.value = "";
  cropPreview.hidden = true;
  cropPreview.removeAttribute("src");
  if (thumbnailPreviewUrl) URL.revokeObjectURL(thumbnailPreviewUrl);
  thumbnailPreviewUrl = "";
}

function drawCrop() {
  if (!cropState.image) return;
  const transform = coverTransform(
    cropState.image.naturalWidth,
    cropState.image.naturalHeight,
    cropCanvas.width,
    cropCanvas.height,
    cropState.zoom,
    cropState.offsetX,
    cropState.offsetY
  );
  cropState.offsetX = transform.offsetX;
  cropState.offsetY = transform.offsetY;
  cropContext.fillStyle = "#171714";
  cropContext.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
  cropContext.drawImage(cropState.image, transform.x, transform.y, transform.width, transform.height);
}

function loadCropImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That image could not be opened. Try a different file."));
    };
    image.src = url;
  });
}

async function openCropper(file) {
  const extension = thumbnailExtension(file);
  if (!extension) throw new Error("Choose a PNG, JPEG, GIF, or WebP thumbnail.");
  if (file.size > 5 * 1024 * 1024) throw new Error("The thumbnail must be 5 MB or smaller.");
  const image = await loadCropImage(file);
  if (image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error("That image is too large to crop safely. Choose an image under 40 megapixels.");
  cropState.image = image;
  cropState.offsetX = 0;
  cropState.offsetY = 0;
  cropState.zoom = 1;
  cropZoom.value = "1";
  drawCrop();
  cropper.showModal();
}

thumbnailInput.addEventListener("change", async () => {
  const file = thumbnailInput.files[0];
  if (!file) return;
  try {
    await openCropper(file);
  } catch (error) {
    clearThumbnailDraft();
    showFormMessage(error.message);
  }
});

cropZoom.addEventListener("input", () => {
  cropState.zoom = Number(cropZoom.value);
  drawCrop();
});

cropCanvas.addEventListener("pointerdown", (event) => {
  cropState.dragging = true;
  cropState.pointerX = event.clientX;
  cropState.pointerY = event.clientY;
  cropCanvas.setPointerCapture(event.pointerId);
});

cropCanvas.addEventListener("pointermove", (event) => {
  if (!cropState.dragging) return;
  const bounds = cropCanvas.getBoundingClientRect();
  cropState.offsetX += (event.clientX - cropState.pointerX) * (cropCanvas.width / bounds.width);
  cropState.offsetY += (event.clientY - cropState.pointerY) * (cropCanvas.height / bounds.height);
  cropState.pointerX = event.clientX;
  cropState.pointerY = event.clientY;
  drawCrop();
});

cropCanvas.addEventListener("pointerup", (event) => {
  cropState.dragging = false;
  cropCanvas.releasePointerCapture(event.pointerId);
});

cropper.querySelector("#crop-reset").addEventListener("click", () => {
  cropState.offsetX = 0;
  cropState.offsetY = 0;
  cropState.zoom = 1;
  cropZoom.value = "1";
  drawCrop();
});

function cancelCrop() {
  cropper.close();
  clearThumbnailDraft();
}

cropper.querySelector("#crop-cancel").addEventListener("click", cancelCrop);
cropper.addEventListener("cancel", (event) => {
  event.preventDefault();
  cancelCrop();
});

cropper.querySelector("#crop-apply").addEventListener("click", () => {
  cropCanvas.toBlob((blob) => {
    if (!blob) {
      showFormMessage("The crop could not be created. Try another image.");
      return;
    }
    croppedThumbnail = new File([blob], "room310-game-cover.jpg", { type: "image/jpeg", lastModified: Date.now() });
    if (thumbnailPreviewUrl) URL.revokeObjectURL(thumbnailPreviewUrl);
    thumbnailPreviewUrl = URL.createObjectURL(croppedThumbnail);
    cropPreview.src = thumbnailPreviewUrl;
    cropPreview.hidden = false;
    showFormMessage("Cover crop ready. Save the game to upload it.", "success");
    cropper.close();
  }, "image/jpeg", 0.9);
});

async function removeObject(bucket, path) {
  if (!path) return;
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw error;
}

async function signedThumbnail(path) {
  if (!path) return "";
  const { data, error } = await supabase.storage.from("game-thumbnails").createSignedUrl(path, 3600);
  if (error) return "";
  return data.signedUrl;
}

async function hydrateGames(rows) {
  return Promise.all(
    rows.map(async (row) => ({ ...gameFromRow(row), thumbnailUrl: await signedThumbnail(row.thumbnail_path) }))
  );
}

async function loadGames() {
  const [{ data, error }, { data: collectionRows, error: collectionError }] = await Promise.all([
    supabase
      .from("games")
      .select("id,title,slug,description,year,status,host_type,external_url,embed_html,thumbnail_path,bundle_path,collection_id,standalone_html_path,source_sha256,source_bytes,standalone_reviewed_sha256,created_at,updated_at")
      .order("updated_at", { ascending: false }),
    supabase.from("game_collections").select("id,title,slug,description,status,created_at,updated_at").order("title")
  ]);
  if (error) throw error;
  if (collectionError) throw collectionError;
  collections = collectionRows || [];
  games = await hydrateGames(data || []);
  renderCollectionOptions();
  render();
}

function renderCollectionOptions() {
  const select = form.elements.collectionId;
  const selected = select.value;
  const options = [new Option("No collection", "")];
  for (const collection of collections) {
    options.push(new Option(`${collection.title} · ${collection.status}`, String(collection.id)));
  }
  select.replaceChildren(...options);
  select.value = selected;
}

function toggleHostFields() {
  document.querySelectorAll("[data-host-field]").forEach((field) => {
    field.hidden = field.dataset.hostField !== hostType.value;
  });
  form.elements.externalUrl.required = hostType.value === "external";
  form.elements.embedHtml.required = hostType.value === "embed";
  const hosted = hostType.value === "hosted";
  const standalone = hostType.value === "standalone";
  const hostedReady = Boolean(editing?.hostType === "hosted" && editing.bundleReady);
  const currentStandaloneReviewed = Boolean(
    editing?.hostType === "standalone"
    && editing.standaloneReady
    && !preparedStandalone
  );
  const candidateStandaloneSha = preparedStandalone?.sha256 || editing?.sourceSha256 || "";
  const newStandaloneReviewed = Boolean(
    candidateStandaloneSha
    && previewedStandaloneSha === candidateStandaloneSha
    && form.elements.standaloneReviewed.checked
  );
  const sourceReady = !hosted && !standalone || hostedReady || currentStandaloneReviewed || newStandaloneReviewed;
  statusSelect.querySelector('[value="published"]').disabled = !sourceReady;
  if (!sourceReady) statusSelect.value = "draft";
}

function clearEmbedPreview() {
  embedPreview.hidden = true;
  embedPreviewViewport.replaceChildren();
}

function clearStandalonePreview({ keepPrepared = false } = {}) {
  standalonePreview.hidden = true;
  standalonePreviewViewport.replaceChildren();
  standaloneScan.hidden = true;
  document.querySelector("#standalone-scan-findings").replaceChildren();
  form.elements.standaloneReviewed.checked = false;
  previewedStandaloneSha = "";
  if (!keepPrepared) preparedStandalone = null;
  toggleHostFields();
}

function renderStandaloneScan(prepared) {
  const findings = scanStandaloneHtml(prepared.html);
  const list = document.querySelector("#standalone-scan-findings");
  list.replaceChildren();
  if (findings.length) {
    for (const finding of findings) {
      const item = document.createElement("li");
      item.textContent = finding;
      list.append(item);
    }
    document.querySelector("#standalone-scan-summary").textContent = "Review these capabilities before publishing. The player sandbox still blocks access to Room310 and top-level navigation.";
  } else {
    document.querySelector("#standalone-scan-summary").textContent = "No commonly risky browser capabilities were detected by the static scan. Manual preview is still required.";
  }
  standaloneScan.hidden = false;
}

async function selectedStandalone() {
  const file = form.elements.standaloneFile.files[0];
  if (file) {
    if (!preparedStandalone || preparedStandalone.sourceName !== file.name || preparedStandalone.originalSize !== file.size) {
      const prepared = await prepareStandaloneFile(file);
      preparedStandalone = { ...prepared, originalSize: file.size };
    }
    return preparedStandalone;
  }
  if (editing?.hostType === "standalone" && editing.standaloneHtmlPath) {
    const html = await loadStandaloneHtml(supabase, editing.standaloneHtmlPath);
    return { html, sha256: editing.sourceSha256, bytes: editing.sourceBytes, uploadFile: null, sourceName: "Stored standalone HTML" };
  }
  throw new Error("Choose an HTML file or a one-file ZIP before previewing.");
}

async function previewStandaloneGame() {
  const button = document.querySelector("#preview-standalone");
  button.disabled = true;
  showFormMessage("Checking and opening the standalone game…", "working");
  try {
    clearStandalonePreview({ keepPrepared: true });
    const prepared = await selectedStandalone();
    renderStandaloneScan(prepared);
    renderSandboxedGame(standalonePreviewViewport, prepared.html, form.elements.title.value.trim() || "Standalone game preview");
    standalonePreview.hidden = false;
    previewedStandaloneSha = prepared.sha256;
    standaloneSummary.textContent = `${prepared.sourceName} · ${(prepared.bytes / 1024 / 1024).toFixed(2)} MB · SHA-256 ${prepared.sha256.slice(0, 12)}…`;
    showFormMessage("Preview is running in the same opaque-origin sandbox used by the published player. Review the findings before publishing.", "success");
  } catch (error) {
    clearStandalonePreview({ keepPrepared: true });
    showFormMessage(error.message);
  } finally {
    button.disabled = false;
    toggleHostFields();
  }
}

function previewEmbeddedGame() {
  try {
    const html = validateEmbedHtml(form.elements.embedHtml.value);
    renderSandboxedGame(embedPreviewViewport, html, form.elements.title.value.trim() || "Embedded game preview");
    embedPreview.hidden = false;
    showFormMessage("Preview running in the same restricted sandbox used by the published player.", "success");
  } catch (error) {
    clearEmbedPreview();
    showFormMessage(error.message);
  }
}

function closeEditor() {
  editor.hidden = true;
  editing = null;
  form.reset();
  clearThumbnailDraft();
  clearEmbedPreview();
  clearStandalonePreview();
  form.elements.standaloneFile.value = "";
  standaloneSummary.textContent = "No standalone file selected.";
  standaloneProgress.hidden = true;
  standaloneProgress.value = 0;
  showFormMessage("");
  toggleHostFields();
}

function openEditor(game = null) {
  editing = game;
  form.reset();
  clearThumbnailDraft();
  clearEmbedPreview();
  clearStandalonePreview();
  form.elements.gameId.value = game?.id || "";
  form.elements.title.value = game?.title || "";
  form.elements.description.value = game?.description || "";
  form.elements.year.value = game?.year || new Date().getFullYear();
  form.elements.hostType.value = game?.hostType || "external";
  form.elements.status.value = game?.status || "draft";
  form.elements.externalUrl.value = game?.externalUrl || "";
  form.elements.embedHtml.value = game?.embedHtml || "";
  form.elements.collectionId.value = game?.collectionId || "";
  form.elements.standaloneReviewed.checked = Boolean(game?.standaloneReady);
  standaloneSummary.textContent = game?.standaloneHtmlPath
    ? `Stored HTML · ${(game.sourceBytes / 1024 / 1024).toFixed(2)} MB · SHA-256 ${game.sourceSha256.slice(0, 12)}…`
    : "No standalone file selected.";
  document.querySelector("#editor-mode").textContent = game ? `Editing ${game.slug}` : "New game";
  const storedMessage = game?.bundleReady
    ? "A ZIP is stored for this game. A new ZIP will replace it."
    : game?.standaloneHtmlPath
      ? "Standalone HTML is stored privately. Preview it again before replacing or publishing it."
      : "";
  showFormMessage(storedMessage, "info");
  toggleHostFields();
  editor.hidden = false;
  editor.scrollIntoView({ behavior: "smooth", block: "start" });
  form.elements.title.focus();
}

function gameCard(game) {
  const article = document.createElement("article");
  article.className = "admin-game-card";

  const preview = document.createElement("div");
  preview.className = "admin-game-thumb";
  if (game.thumbnailUrl) {
    const image = document.createElement("img");
    image.src = game.thumbnailUrl;
    image.alt = "";
    preview.append(image);
  } else {
    preview.textContent = game.title.slice(0, 1).toUpperCase();
  }

  const body = document.createElement("div");
  body.className = "admin-game-card-body";
  const meta = document.createElement("div");
  meta.className = "admin-game-meta";
  const status = document.createElement("span");
  status.className = `admin-status admin-status-${game.status}`;
  status.textContent = game.status;
  const type = document.createElement("span");
  type.textContent = game.hostType === "hosted"
    ? (game.bundleReady ? "Hosted · stored" : "Hosted · ZIP needed")
    : game.hostType === "standalone"
      ? (game.standaloneReady ? "Standalone · reviewed" : game.standaloneHtmlPath ? "Standalone · review needed" : "Standalone · file needed")
      : game.hostType === "embed" ? "Pasted HTML" : "Linked game";
  meta.append(status, type);

  const title = document.createElement("h3");
  title.textContent = game.title;
  const description = document.createElement("p");
  description.textContent = game.description;
  const dates = document.createElement("small");
  dates.textContent = `${game.year} · Updated ${new Date(game.updatedAt).toLocaleDateString()}`;
  const actions = document.createElement("div");
  actions.className = "admin-card-actions";

  const edit = Object.assign(document.createElement("button"), { type: "button", textContent: "Edit" });
  edit.addEventListener("click", () => openEditor(game));

  const publish = Object.assign(document.createElement("button"), {
    type: "button",
    textContent: game.status === "published" ? "Unpublish" : "Publish",
    disabled: (game.hostType === "hosted" && !game.bundleReady) || (game.hostType === "standalone" && !game.standaloneReady)
  });
  if (game.hostType === "hosted" && !game.bundleReady) publish.title = "Upload a ZIP before publishing this game.";
  if (game.hostType === "standalone" && !game.standaloneReady) publish.title = "Preview and review the exact standalone file before publishing it.";
  publish.addEventListener("click", async () => {
    publish.disabled = true;
    try {
      const { error } = await supabase
        .from("games")
        .update({ status: game.status === "published" ? "draft" : "published" })
        .eq("id", game.id);
      if (error) throw error;
      await loadGames();
    } catch (error) {
      alert(messageFor(error));
      publish.disabled = false;
    }
  });

  const remove = Object.assign(document.createElement("button"), { type: "button", textContent: "Delete" });
  remove.className = "danger-action";
  remove.addEventListener("click", async () => {
    if (!confirm(`Delete “${game.title}”? Its thumbnail and uploaded game file will also be permanently removed.`)) return;
    remove.disabled = true;
    try {
      await removeObject("game-thumbnails", game.thumbnailPath);
      await removeObject("game-bundles", game.bundlePath);
      await removeObject("game-standalone", game.standaloneHtmlPath);
      const { error } = await supabase.from("games").delete().eq("id", game.id);
      if (error) throw error;
      await loadGames();
    } catch (error) {
      alert(messageFor(error));
      remove.disabled = false;
    }
  });

  actions.append(edit, publish, remove);
  body.append(meta, title, description, dates, actions);
  article.append(preview, body);
  return article;
}

function render() {
  renderCollections();
  list.replaceChildren();
  if (!games.length) {
    const empty = document.createElement("div");
    empty.className = "admin-empty-state";
    const title = document.createElement("h3");
    title.textContent = "No games have been added.";
    const copy = document.createElement("p");
    copy.textContent = "Create an external, embedded HTML, standalone HTML, or hosted-game draft, then publish it when it is ready.";
    empty.append(title, copy);
    list.append(empty);
    return;
  }
  games.forEach((game) => list.append(gameCard(game)));
}

function renderCollections() {
  collectionList.replaceChildren();
  if (!collections.length) {
    const empty = document.createElement("p");
    empty.textContent = "No collections are configured.";
    collectionList.append(empty);
    return;
  }
  for (const collection of collections) {
    const members = games.filter((game) => game.collectionId === collection.id);
    const published = members.filter((game) => game.status === "published");
    const reviewed = members.filter((game) => game.hostType !== "standalone" || game.standaloneReady);
    const isPilot = collection.slug === "100-games";
    const ready = members.length > 0
      && published.length === members.length
      && reviewed.length === members.length
      && (!isPilot || members.length >= 15);
    const article = document.createElement("article");
    article.className = "admin-collection-card";
    const copy = document.createElement("div");
    const meta = document.createElement("small");
    meta.textContent = `${collection.status} · ${published.length}/${members.length} games published · ${reviewed.length}/${members.length} reviewed`;
    const title = document.createElement("h3");
    title.textContent = collection.title;
    const description = document.createElement("p");
    description.textContent = collection.description;
    copy.append(meta, title, description);
    const action = document.createElement("button");
    action.type = "button";
    action.textContent = collection.status === "published" ? "Unpublish collection" : isPilot ? "Publish and retire old link" : "Publish collection";
    action.disabled = collection.status !== "published" && !ready;
    if (action.disabled) action.title = isPilot ? "The pilot needs at least 15 reviewed, published games before cutover." : "Review and publish every member game first.";
    action.addEventListener("click", async () => {
      action.disabled = true;
      try {
        if (collection.status === "published") {
          const { error } = await supabase.from("game_collections").update({ status: "draft" }).eq("id", collection.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.rpc("publish_game_collection", {
            collection_to_publish: collection.id,
            external_game_to_retire: isPilot ? 55 : null
          });
          if (error) throw error;
        }
        await loadGames();
      } catch (error) {
        alert(messageFor(error));
        action.disabled = false;
      }
    });
    article.append(copy, action);
    collectionList.append(article);
  }
}

async function uploadThumbnail(game, file) {
  if (!file) return game;
  const extension = thumbnailExtension(file);
  if (!extension) throw new Error("Choose a PNG, JPEG, GIF, or WebP thumbnail.");
  if (file.size > 5 * 1024 * 1024) throw new Error("The thumbnail must be 5 MB or smaller.");
  const path = uniquePath(game.id, "thumbnail", extension);
  const { error: uploadError } = await supabase.storage.from("game-thumbnails").upload(path, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: false
  });
  if (uploadError) throw uploadError;
  const { data, error } = await supabase.from("games").update({ thumbnail_path: path }).eq("id", game.id).select().single();
  if (error) {
    await removeObject("game-thumbnails", path).catch(() => {});
    throw error;
  }
  await removeObject("game-thumbnails", game.thumbnail_path).catch(() => {});
  return data;
}

async function uploadBundle(game, file) {
  if (!file) return game;
  if (!file.name.toLowerCase().endsWith(".zip")) throw new Error("Choose a ZIP file for the hosted game.");
  if (file.size > 20 * 1024 * 1024) throw new Error("The hosted ZIP must be 20 MB or smaller.");
  const path = uniquePath(game.id, "game", "zip");
  const { error: uploadError } = await supabase.storage.from("game-bundles").upload(path, file, {
    cacheControl: "3600",
    contentType: "application/zip",
    upsert: false
  });
  if (uploadError) throw uploadError;
  const { data, error } = await supabase.from("games").update({ bundle_path: path, status: "draft" }).eq("id", game.id).select().single();
  if (error) {
    await removeObject("game-bundles", path).catch(() => {});
    throw error;
  }
  await removeObject("game-bundles", game.bundle_path).catch(() => {});
  return data;
}

async function uploadStandalone(game, prepared, reviewed) {
  if (!prepared?.uploadFile) return game;
  const path = `${game.id}/standalone-${prepared.sha256}.html`;
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session?.access_token) throw sessionError || new Error("Your administrator session expired.");
  standaloneProgress.hidden = false;
  standaloneProgress.value = 0;
  await uploadStandaloneTus({
    projectUrl,
    publishableKey,
    accessToken: sessionData.session.access_token,
    file: prepared.uploadFile,
    objectName: path,
    onProgress(uploaded, total) {
      const percent = Math.round((uploaded / total) * 100);
      standaloneProgress.value = percent;
      standaloneProgress.textContent = `${percent}%`;
      showFormMessage(`Uploading standalone game… ${percent}%`, "working");
    }
  });
  const { data, error } = await supabase
    .from("games")
    .update({
      standalone_html_path: path,
      source_sha256: prepared.sha256,
      source_bytes: prepared.bytes,
      standalone_reviewed_sha256: reviewed ? prepared.sha256 : null,
      status: "draft"
    })
    .eq("id", game.id)
    .select()
    .single();
  if (error) {
    if (path !== game.standalone_html_path) await removeObject("game-standalone", path).catch(() => {});
    throw error;
  }
  if (game.standalone_html_path && game.standalone_html_path !== path) {
    await removeObject("game-standalone", game.standalone_html_path).catch(() => {});
  }
  return data;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  showFormMessage("Saving game…", "working");

  try {
    const bundle = form.elements.bundle.files[0];
    const standaloneFile = form.elements.standaloneFile.files[0];
    if (hostType.value === "standalone" && standaloneFile && !preparedStandalone) {
      showFormMessage("Checking standalone game file…", "working");
      const prepared = await prepareStandaloneFile(standaloneFile);
      preparedStandalone = { ...prepared, originalSize: standaloneFile.size };
    }
    const wantedStatus = statusSelect.value;
    const exactStandaloneReviewed = Boolean(
      form.elements.standaloneReviewed.checked
      && previewedStandaloneSha
      && previewedStandaloneSha === (preparedStandalone?.sha256 || editing?.sourceSha256)
    );
    const standaloneNeedsDraft = hostType.value === "standalone" && (
      standaloneFile
      || !editing?.standaloneHtmlPath
      || (!editing?.standaloneReady && !exactStandaloneReviewed)
    );
    const payload = {
      title: form.elements.title.value.trim(),
      description: form.elements.description.value.trim(),
      year: Number(form.elements.year.value),
      host_type: hostType.value,
      status: (hostType.value === "hosted" && (bundle || !editing?.bundleReady)) || standaloneNeedsDraft ? "draft" : wantedStatus,
      external_url: hostType.value === "external" ? form.elements.externalUrl.value.trim() : null,
      embed_html: hostType.value === "embed" ? validateEmbedHtml(form.elements.embedHtml.value) : null,
      bundle_path: hostType.value === "hosted" ? editing?.bundlePath || null : null,
      collection_id: form.elements.collectionId.value ? Number(form.elements.collectionId.value) : null,
      standalone_html_path: hostType.value === "standalone" ? editing?.standaloneHtmlPath || null : null,
      source_sha256: hostType.value === "standalone" ? editing?.sourceSha256 || null : null,
      source_bytes: hostType.value === "standalone" ? editing?.sourceBytes || null : null,
      standalone_reviewed_sha256: hostType.value === "standalone"
        ? standaloneFile
          ? null
          : exactStandaloneReviewed ? editing?.sourceSha256 : editing?.standaloneReviewedSha256 || null
        : null
    };
    if (!editing) payload.slug = `${slugify(payload.title)}-${crypto.randomUUID().slice(0, 8)}`;

    const query = editing
      ? supabase.from("games").update(payload).eq("id", editing.id)
      : supabase.from("games").insert(payload);
    const { data, error } = await query.select().single();
    if (error) throw error;

    let row = data;
    const thumbnail = croppedThumbnail;
    if (thumbnail) {
      showFormMessage("Uploading thumbnail…", "working");
      row = await uploadThumbnail(row, thumbnail);
    }
    if (bundle) {
      showFormMessage("Storing hosted-game ZIP…", "working");
      row = await uploadBundle(row, bundle);
    }
    if (hostType.value === "standalone" && preparedStandalone?.uploadFile) {
      row = await uploadStandalone(row, preparedStandalone, exactStandaloneReviewed);
    } else if (hostType.value === "standalone" && exactStandaloneReviewed && row.standalone_reviewed_sha256 !== row.source_sha256) {
      const { data: reviewed, error: reviewError } = await supabase
        .from("games")
        .update({ standalone_reviewed_sha256: row.source_sha256 })
        .eq("id", row.id)
        .select()
        .single();
      if (reviewError) throw reviewError;
      row = reviewed;
    }
    if (hostType.value === "hosted" && bundle && wantedStatus === "published") {
      const { data: published, error: publishError } = await supabase
        .from("games")
        .update({ status: "published" })
        .eq("id", row.id)
        .select()
        .single();
      if (publishError) throw publishError;
      row = published;
    }
    if (hostType.value === "standalone" && wantedStatus === "published") {
      const { data: published, error: publishError } = await supabase
        .from("games")
        .update({ status: "published" })
        .eq("id", row.id)
        .select()
        .single();
      if (publishError) throw publishError;
      row = published;
    }
    if (editing?.bundlePath && hostType.value !== "hosted") {
      await removeObject("game-bundles", editing.bundlePath).catch(() => {});
    }
    if (editing?.standaloneHtmlPath && hostType.value !== "standalone") {
      await removeObject("game-standalone", editing.standaloneHtmlPath).catch(() => {});
    }

    closeEditor();
    await loadGames();
  } catch (error) {
    showFormMessage(messageFor(error));
  } finally {
    submit.disabled = false;
  }
});

hostType.addEventListener("change", toggleHostFields);
form.elements.embedHtml.addEventListener("input", clearEmbedPreview);
form.elements.standaloneFile.addEventListener("change", () => {
  clearStandalonePreview();
  const file = form.elements.standaloneFile.files[0];
  standaloneSummary.textContent = file ? `${file.name} · waiting for scan` : "No standalone file selected.";
});
form.elements.standaloneReviewed.addEventListener("change", toggleHostFields);
document.querySelector("#preview-embed").addEventListener("click", previewEmbeddedGame);
document.querySelector("#preview-standalone").addEventListener("click", previewStandaloneGame);
document.querySelector("#new-game").addEventListener("click", () => openEditor());
document.querySelector("#cancel-edit").addEventListener("click", closeEditor);
document.querySelector("#cancel-edit-bottom").addEventListener("click", closeEditor);
document.querySelector("#admin-logout").addEventListener("click", async () => {
  await supabase?.auth.signOut();
  location.assign("/admin/login");
});

async function start() {
  if (!isConfigured) throw new Error(configurationMessage);
  const manager = await getManager();
  if (!manager) {
    await supabase.auth.signOut();
    location.replace("/admin/login");
    return;
  }
  document.querySelector("#admin-user").textContent = `${manager.profile.display_name} · ${manager.profile.role}`;
  await loadGames();
}

toggleHostFields();
start().catch((error) => {
  list.textContent = messageFor(error, "The games dashboard could not be loaded.");
});
