import { configurationMessage, isConfigured, messageFor, supabase } from "./supabase-client.js";
import { renderSandboxedGame, renderSandboxedUrl } from "./embed-runner.js";
import { gameFromRow } from "./game-utils.js";

const shell = document.querySelector(".game-player-shell");
const viewport = document.querySelector("#game-viewport");
const loading = document.querySelector("#game-loading");
const errorPanel = document.querySelector("#game-error");
const fullscreen = document.querySelector("#game-fullscreen");
const externalFallback = document.querySelector("#game-open-external");

function slugFromPath() {
  const match = location.pathname.match(/^\/games\/play\/([a-z0-9][a-z0-9-]{0,69})\/?$/);
  return match?.[1] || "";
}

function showError(text) {
  loading.hidden = true;
  errorPanel.querySelector("p").textContent = text;
  errorPanel.hidden = false;
  shell.dataset.state = "error";
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
  if (!isConfigured) throw new Error(configurationMessage);
  const slug = slugFromPath();
  if (!slug) throw new Error("This game link is not valid.");

  const { data, error } = await supabase
    .from("games")
    .select("id,title,slug,description,year,status,host_type,external_url,embed_html,thumbnail_path,bundle_path,created_at,updated_at")
    .eq("slug", slug)
    .single();
  if (error?.code === "PGRST116") throw new Error("This game is unavailable or still a draft.");
  if (error || !data) throw error || new Error("Game not found.");

  const game = gameFromRow(data);
  if (game.hostType === "embed" && !game.embedHtml) throw new Error("This embedded game has no HTML source.");
  if (game.hostType === "external" && !game.externalUrl) throw new Error("This external game has no playable URL.");
  if (game.hostType === "hosted" && !game.bundleReady) throw new Error("This hosted game has no ZIP bundle.");

  document.title = `${game.title} · Room310 Games`;
  document.querySelector("#game-title").textContent = game.title;
  document.querySelector("#game-description").textContent = game.description;
  document.querySelector("#game-year").textContent = game.year;
  document.querySelector("#game-source").textContent = game.hostType === "hosted"
    ? "Hosted ZIP"
    : game.hostType === "external" ? "Linked game" : "Embedded HTML";

  const ready = () => {
    loading.hidden = true;
    shell.dataset.state = "ready";
  };
  if (game.hostType === "embed") {
    renderSandboxedGame(viewport, game.embedHtml, game.title, ready);
  } else {
    const url = game.hostType === "hosted"
      ? `/game-assets/${encodeURIComponent(game.slug)}/index.html?v=${encodeURIComponent(game.updatedAt || "1")}`
      : game.externalUrl;
    renderSandboxedUrl(viewport, url, game.title, ready);
    if (game.hostType === "external") {
      externalFallback.href = game.externalUrl;
      externalFallback.hidden = false;
    }
  }
}

fullscreen.hidden = !document.fullscreenEnabled;
fullscreen.addEventListener("click", openFullscreen);
document.addEventListener("fullscreenchange", () => {
  fullscreen.textContent = document.fullscreenElement ? "Exit fullscreen" : "Fullscreen";
});

loadGame().catch((error) => showError(messageFor(error, "This game could not be loaded.")));
