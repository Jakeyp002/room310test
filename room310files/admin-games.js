(() => {
  "use strict";
  const list = document.querySelector("#admin-games-list");
  const editor = document.querySelector("#game-editor");
  const form = document.querySelector("#game-form");
  const message = document.querySelector("#game-form-message");
  const hostType = form.elements.hostType;
  let games = [];
  let editing = null;

  const csrf = () => decodeURIComponent((document.cookie.split("; ").find((row) => row.startsWith("room310_csrf=")) || "=").split("=").slice(1).join("="));
  const api = async (url, options = {}) => {
    const headers = new Headers(options.headers || {});
    if (options.method && options.method !== "GET") headers.set("X-CSRF-Token", csrf());
    const response = await fetch(url, { credentials: "same-origin", ...options, headers });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) location.assign("/admin/login");
    if (!response.ok) throw new Error(result.error || "The request could not be completed.");
    return result;
  };

  const payloadFromForm = (status = form.elements.status.value) => ({
    title: form.elements.title.value,
    description: form.elements.description.value,
    year: Number(form.elements.year.value),
    hostType: hostType.value,
    status,
    externalUrl: form.elements.externalUrl.value
  });

  const toggleHostFields = () => {
    document.querySelectorAll("[data-host-field]").forEach((field) => {
      field.hidden = field.dataset.hostField !== hostType.value;
    });
    form.elements.externalUrl.required = hostType.value === "external";
  };

  const closeEditor = () => {
    editor.hidden = true;
    editing = null;
    form.reset();
    message.textContent = "";
    toggleHostFields();
  };

  const openEditor = (game = null) => {
    editing = game;
    form.reset();
    form.elements.gameId.value = game?.id || "";
    form.elements.title.value = game?.title || "";
    form.elements.description.value = game?.description || "";
    form.elements.year.value = game?.year || new Date().getFullYear();
    form.elements.hostType.value = game?.hostType || "external";
    form.elements.status.value = game?.status || "draft";
    form.elements.externalUrl.value = game?.externalUrl || "";
    document.querySelector("#editor-mode").textContent = game ? `Editing ${game.slug}` : "New game";
    message.textContent = game?.bundleReady ? "A hosted bundle is already installed. Choosing a new ZIP will replace it." : "";
    toggleHostFields();
    editor.hidden = false;
    editor.scrollIntoView({ behavior: "smooth", block: "start" });
    form.elements.title.focus();
  };

  const gameCard = (game) => {
    const article = document.createElement("article");
    article.className = "admin-game-card";
    const preview = document.createElement("div");
    preview.className = "admin-game-thumb";
    if (game.thumbnailUrl) {
      const image = document.createElement("img");
      image.src = `${game.thumbnailUrl}?v=${encodeURIComponent(game.updatedAt)}`;
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
    type.textContent = game.hostType === "hosted" ? (game.bundleReady ? "Hosted · ready" : "Hosted · ZIP needed") : "External";
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
    const publish = Object.assign(document.createElement("button"), { type: "button", textContent: game.status === "published" ? "Unpublish" : "Publish" });
    publish.addEventListener("click", async () => {
      publish.disabled = true;
      try {
        await api(`/api/admin/games/${game.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...game, status: game.status === "published" ? "draft" : "published" }) });
        await loadGames();
      } catch (error) { alert(error.message); } finally { publish.disabled = false; }
    });
    const remove = Object.assign(document.createElement("button"), { type: "button", textContent: "Delete" });
    remove.className = "danger-action";
    remove.addEventListener("click", async () => {
      if (!confirm(`Delete “${game.title}”? Its thumbnail and hosted files will also be permanently removed.`)) return;
      remove.disabled = true;
      try { await api(`/api/admin/games/${game.id}`, { method: "DELETE" }); await loadGames(); }
      catch (error) { alert(error.message); remove.disabled = false; }
    });
    actions.append(edit, publish, remove);
    body.append(meta, title, description, dates, actions);
    article.append(preview, body);
    return article;
  };

  const render = () => {
    list.replaceChildren();
    if (!games.length) {
      const empty = document.createElement("div");
      empty.className = "admin-empty-state";
      const title = document.createElement("h3");
      title.textContent = "No games have been added.";
      const copy = document.createElement("p");
      copy.textContent = "Create the first draft, then publish it when it is ready.";
      empty.append(title, copy);
      list.append(empty);
      return;
    }
    games.forEach((game) => list.append(gameCard(game)));
  };

  const loadGames = async () => {
    const result = await api("/api/admin/games");
    games = result.games;
    render();
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    message.textContent = "Saving game…";
    try {
      const bundle = form.elements.bundle.files[0];
      const thumbnail = form.elements.thumbnail.files[0];
      const wantedStatus = form.elements.status.value;
      const mustPublishAfterUpload = hostType.value === "hosted" && wantedStatus === "published" && bundle;
      const metadata = payloadFromForm(mustPublishAfterUpload ? "draft" : wantedStatus);
      let result = await api(editing ? `/api/admin/games/${editing.id}` : "/api/admin/games", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metadata)
      });
      const game = result.game;
      if (thumbnail) {
        const upload = new FormData();
        upload.append("thumbnail", thumbnail);
        await api(`/api/admin/games/${game.id}/thumbnail`, { method: "POST", body: upload });
      }
      if (bundle) {
        message.textContent = "Checking and installing hosted game…";
        const upload = new FormData();
        upload.append("bundle", bundle);
        await api(`/api/admin/games/${game.id}/bundle`, { method: "POST", body: upload });
      }
      if (mustPublishAfterUpload) {
        await api(`/api/admin/games/${game.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payloadFromForm("published")) });
      }
      closeEditor();
      await loadGames();
    } catch (error) {
      message.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });

  hostType.addEventListener("change", toggleHostFields);
  document.querySelector("#new-game").addEventListener("click", () => openEditor());
  document.querySelector("#cancel-edit").addEventListener("click", closeEditor);
  document.querySelector("#cancel-edit-bottom").addEventListener("click", closeEditor);
  document.querySelector("#admin-logout").addEventListener("click", async () => {
    try { await api("/api/auth/logout", { method: "POST" }); } finally { location.assign("/admin/login"); }
  });

  Promise.all([api("/api/auth/session"), loadGames()]).then(([session]) => {
    document.querySelector("#admin-user").textContent = `${session.user.display_name} · ${session.user.role}`;
  }).catch((error) => { list.textContent = error.message; });
  toggleHostFields();
})();
