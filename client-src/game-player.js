import { configurationMessage, isConfigured, messageFor, supabase } from "./supabase-client.js";
import { renderSandboxedGame, renderSandboxedUrl } from "./embed-runner.js";
import { gameFromRow } from "./game-utils.js";
import { loadStandaloneHtml } from "./standalone-game.js";

const shell = document.querySelector(".game-player-shell");
const viewport = document.querySelector("#game-viewport");
const loading = document.querySelector("#game-loading");
const errorPanel = document.querySelector("#game-error");
const fullscreen = document.querySelector("#game-fullscreen");
const externalChoice = document.querySelector("#game-external-choice");
const playExternal = document.querySelector("#game-play-external");
const openExperimental = document.querySelector("#game-open-experimental");
const retry = document.querySelector("#game-retry");
let externalGame = null;
let loadController = null;

function slugFromPath() {
  const match = location.pathname.match(/^\/games\/play\/([a-z0-9][a-z0-9-]{0,69})\/?$/);
  return match?.[1] || "";
}

function showError(text) {
  loading.hidden = true;
  externalChoice.hidden = true;
  fullscreen.hidden = true;
  errorPanel.querySelector("p").textContent = text;
  errorPanel.hidden = false;
  retry.hidden = false;
  shell.dataset.state = "error";
}

function showExternalChoice(game) {
  externalGame = game;
  playExternal.href = game.externalUrl;
  loading.hidden = true;
  externalChoice.hidden = false;
  fullscreen.hidden = true;
  shell.dataset.state = "choice";
}

function openExternalExperiment() {
  if (!externalGame) return;
  externalChoice.hidden = true;
  loading.querySelector("strong").textContent = "Opening experimental player";
  loading.querySelector("small").textContent = "Some online games block embedded play…";
  loading.hidden = false;
  openExperimental.disabled = true;
  renderSandboxedUrl(viewport, externalGame.externalUrl, externalGame.title, () => {
    loading.hidden = true;
    fullscreen.hidden = !document.fullscreenEnabled;
    shell.dataset.state = "ready";
  });
}

async function openFullscreen() {
  if (!document.fullscreenEnabled || !viewport.requestFullscreen) return;
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await viewport.requestFullscreen();
  } catch {
    showError("Fullscreen was blocked by the browser. The game is still available in the player.");
  }
}

async function loadGame() {
  loadController?.abort();
  loadController = new AbortController();
  errorPanel.hidden = true;
  externalChoice.hidden = true;
  loading.hidden = false;
  loading.querySelector("strong").textContent = "Starting game";
  loading.querySelector("small").textContent = "Loading in a secure sandbox…";
  shell.dataset.state = "loading";
  if (!isConfigured) throw new Error(configurationMessage);
  const slug = slugFromPath();
  if (!slug) throw new Error("This game link is not valid.");

  const { data, error } = await supabase
    .from("games")
    .select("id,title,slug,description,year,status,host_type,external_url,embed_html,thumbnail_path,bundle_path,collection_id,standalone_html_path,source_sha256,source_bytes,standalone_reviewed_sha256,created_at,updated_at,game_collections(slug,title)")
    .eq("slug", slug)
    .single();
  if (error?.code === "PGRST116") throw new Error("This game is unavailable or still a draft.");
  if (error || !data) throw error || new Error("Game not found.");

  const game = gameFromRow(data);
  if (game.hostType === "embed" && !game.embedHtml) throw new Error("This embedded game has no HTML source.");
  if (game.hostType === "external" && !game.externalUrl) throw new Error("This external game has no playable URL.");
  if (game.hostType === "hosted" && !game.bundleReady) throw new Error("This hosted game has no ZIP bundle.");
  if (game.hostType === "standalone" && !game.standaloneReady) throw new Error("This standalone game has not finished security review.");

  document.title = `${game.title} · Room310 Games`;
  document.querySelector("#game-title").textContent = game.title;
  document.querySelector("#game-description").textContent = game.description;
  document.querySelector("#game-year").textContent = game.year;
  document.querySelector("#game-source").textContent = game.hostType === "hosted"
    ? "Hosted ZIP"
    : game.hostType === "standalone" ? "Room310 hosted" : game.hostType === "external" ? "Linked game" : "Embedded HTML";
  if (game.collection?.slug) {
    const back = document.querySelector("#game-back");
    back.href = `/games/collections/${encodeURIComponent(game.collection.slug)}/`;
    back.textContent = `← ${game.collection.title}`;
  }

  const ready = () => {
    loading.hidden = true;
    fullscreen.hidden = !document.fullscreenEnabled;
    shell.dataset.state = "ready";
  };
  if (game.hostType === "embed") {
    renderSandboxedGame(viewport, game.embedHtml, game.title, ready);
  } else if (game.hostType === "external") {
    showExternalChoice(game);
  } else if (game.hostType === "hosted") {
    const url = `/game-assets/${encodeURIComponent(game.slug)}/index.html?v=${encodeURIComponent(game.updatedAt || "1")}`;
    renderSandboxedUrl(viewport, url, game.title, ready);
  } else {
    loading.querySelector("small").textContent = "Downloading the reviewed game file from private storage…";
    const timeout = setTimeout(() => loadController.abort(), 30_000);
    try {
      const html = await loadStandaloneHtml(supabase, game.standaloneHtmlPath, { signal: loadController.signal });
      renderSandboxedGame(viewport, html, game.title, ready);
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("The game download timed out. Check your connection and try again.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

fullscreen.hidden = true;
fullscreen.addEventListener("click", openFullscreen);
openExperimental.addEventListener("click", openExternalExperiment);
retry.addEventListener("click", () => loadGame().catch((error) => showError(messageFor(error, "This game could not be loaded."))));
document.addEventListener("fullscreenchange", () => {
  fullscreen.textContent = document.fullscreenElement ? "Exit fullscreen" : "Fullscreen";
});

loadGame().catch((error) => showError(messageFor(error, "This game could not be loaded.")));
