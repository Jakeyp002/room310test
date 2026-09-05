import { configurationMessage, getManager, isConfigured, messageFor, supabase } from "./supabase-client.js";
import { gameFromRow, slugify, thumbnailExtension } from "./game-utils.js";
import { coverTransform } from "./image-crop-utils.js";

const list = document.querySelector("#admin-games-list");
const editor = document.querySelector("#game-editor");
const form = document.querySelector("#game-form");
const message = document.querySelector("#game-form-message");
const hostType = form.elements.hostType;
const statusSelect = form.elements.status;
let games = [];
let editing = null;
let croppedThumbnail = null;
let thumbnailPreviewUrl = "";

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
  const { data, error } = await supabase
    .from("games")
    .select("id,title,slug,description,year,status,host_type,external_url,thumbnail_path,bundle_path,created_at,updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  games = await hydrateGames(data || []);
  render();
}

function toggleHostFields() {
  document.querySelectorAll("[data-host-field]").forEach((field) => {
    field.hidden = field.dataset.hostField !== hostType.value;
  });
  form.elements.externalUrl.required = hostType.value === "external";
  const hosted = hostType.value === "hosted";
  statusSelect.querySelector('[value="published"]').disabled = hosted;
  if (hosted) statusSelect.value = "draft";
}

function closeEditor() {
  editor.hidden = true;
  editing = null;
  form.reset();
  clearThumbnailDraft();
  showFormMessage("");
  toggleHostFields();
}

function openEditor(game = null) {
  editing = game;
  form.reset();
  clearThumbnailDraft();
  form.elements.gameId.value = game?.id || "";
  form.elements.title.value = game?.title || "";
  form.elements.description.value = game?.description || "";
  form.elements.year.value = game?.year || new Date().getFullYear();
  form.elements.hostType.value = game?.hostType || "external";
  form.elements.status.value = game?.status || "draft";
  form.elements.externalUrl.value = game?.externalUrl || "";
  document.querySelector("#editor-mode").textContent = game ? `Editing ${game.slug}` : "New game";
  showFormMessage(game?.bundleReady ? "A ZIP is stored for this draft. A new ZIP will replace it." : "", "info");
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
  type.textContent = game.hostType === "hosted" ? (game.bundleReady ? "Hosted · stored" : "Hosted · ZIP needed") : "External";
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
    disabled: game.hostType === "hosted"
  });
  if (game.hostType === "hosted") publish.title = "Hosted ZIP publishing arrives with the isolated runner.";
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
    if (!confirm(`Delete “${game.title}”? Its thumbnail and ZIP will also be permanently removed.`)) return;
    remove.disabled = true;
    try {
      await removeObject("game-thumbnails", game.thumbnailPath);
      await removeObject("game-bundles", game.bundlePath);
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
  list.replaceChildren();
  if (!games.length) {
    const empty = document.createElement("div");
    empty.className = "admin-empty-state";
    const title = document.createElement("h3");
    title.textContent = "No games have been added.";
    const copy = document.createElement("p");
    copy.textContent = "Create an external-game draft, then publish it when it is ready.";
    empty.append(title, copy);
    list.append(empty);
    return;
  }
  games.forEach((game) => list.append(gameCard(game)));
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

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  showFormMessage("Saving game…", "working");

  try {
    const payload = {
      title: form.elements.title.value.trim(),
      description: form.elements.description.value.trim(),
      year: Number(form.elements.year.value),
      host_type: hostType.value,
      status: hostType.value === "hosted" ? "draft" : statusSelect.value,
      external_url: hostType.value === "external" ? form.elements.externalUrl.value.trim() : null,
      bundle_path: hostType.value === "external" ? null : editing?.bundlePath || null
    };
    if (!editing) payload.slug = `${slugify(payload.title)}-${crypto.randomUUID().slice(0, 8)}`;

    const query = editing
      ? supabase.from("games").update(payload).eq("id", editing.id)
      : supabase.from("games").insert(payload);
    const { data, error } = await query.select().single();
    if (error) throw error;

    let row = data;
    const thumbnail = croppedThumbnail;
    const bundle = form.elements.bundle.files[0];
    if (thumbnail) {
      showFormMessage("Uploading thumbnail…", "working");
      row = await uploadThumbnail(row, thumbnail);
    }
    if (bundle) {
      showFormMessage("Storing hosted-game ZIP…", "working");
      row = await uploadBundle(row, bundle);
    }
    if (editing?.bundlePath && hostType.value === "external") {
      await removeObject("game-bundles", editing.bundlePath).catch(() => {});
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
