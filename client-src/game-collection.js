import { configurationMessage, isConfigured, messageFor, supabase } from "./supabase-client.js";
import { gameFromRow, gamePlayUrl } from "./game-utils.js";

const grid = document.querySelector("#collection-games");
const search = document.querySelector("#collection-search");
const count = document.querySelector("#collection-count");
let games = [];

function slugFromPath() {
  return location.pathname.match(/^\/games\/collections\/([a-z0-9][a-z0-9-]{0,69})\/?$/)?.[1] || "";
}

function card(game, index) {
  const article = document.createElement("article");
  article.className = "collection-game-card";
  const cover = document.createElement("div");
  cover.className = "collection-game-cover";
  if (game.thumbnailUrl) {
    const image = document.createElement("img");
    image.src = game.thumbnailUrl;
    image.alt = `Cover artwork for ${game.title}`;
    image.loading = "lazy";
    cover.append(image);
  } else {
    const number = document.createElement("span");
    number.textContent = String(index + 1).padStart(2, "0");
    cover.append(number);
  }
  const body = document.createElement("div");
  body.className = "collection-game-body";
  const meta = document.createElement("small");
  meta.textContent = `${game.year} · ${game.hostType === "standalone" ? "Room310 hosted" : "Game"}`;
  const title = document.createElement("h2");
  title.textContent = game.title;
  const description = document.createElement("p");
  description.textContent = game.description;
  const play = document.createElement("a");
  play.href = gamePlayUrl(game);
  play.textContent = "Play game →";
  body.append(meta, title, description, play);
  article.append(cover, body);
  return article;
}

function render() {
  const query = search.value.trim().toLocaleLowerCase();
  const visible = games.filter((game) => `${game.title} ${game.description} ${game.year}`.toLocaleLowerCase().includes(query));
  grid.replaceChildren();
  count.textContent = query ? `${visible.length} of ${games.length} games` : `${games.length} games`;
  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "collection-empty";
    const title = document.createElement("strong");
    title.textContent = query ? "No games match that search." : "No games are published in this collection yet.";
    const copy = document.createElement("p");
    copy.textContent = query ? "Try a shorter title or clear the search." : "The Room310 team is reviewing the first games now.";
    empty.append(title, copy);
    grid.append(empty);
    return;
  }
  grid.append(...visible.map(card));
}

async function loadCollection() {
  if (!isConfigured) throw new Error(configurationMessage);
  const slug = slugFromPath();
  if (!slug) throw new Error("This collection link is not valid.");
  const { data: collection, error } = await supabase
    .from("game_collections")
    .select("id,title,slug,description,status")
    .eq("slug", slug)
    .single();
  if (error?.code === "PGRST116") throw new Error("This collection is unavailable or still a draft.");
  if (error || !collection) throw error || new Error("Collection not found.");
  const { data: rows, error: gameError } = await supabase
    .from("games")
    .select("id,title,slug,description,year,status,host_type,external_url,thumbnail_path,bundle_path,collection_id,standalone_html_path,source_sha256,source_bytes,standalone_reviewed_sha256,created_at,updated_at")
    .eq("collection_id", collection.id)
    .order("title");
  if (gameError) throw gameError;
  games = await Promise.all((rows || []).map(async (row) => {
    const game = gameFromRow(row);
    if (!game.thumbnailPath) return { ...game, thumbnailUrl: "" };
    const { data: signed } = await supabase.storage.from("game-thumbnails").createSignedUrl(game.thumbnailPath, 3600);
    return { ...game, thumbnailUrl: signed?.signedUrl || "" };
  }));
  document.title = `${collection.title} · Room310 Games`;
  document.querySelector("#collection-title").textContent = collection.title;
  document.querySelector("#collection-description").textContent = collection.description;
  search.disabled = false;
  render();
}

search.addEventListener("input", render);
loadCollection().catch((error) => {
  document.querySelector("#collection-title").textContent = "Collection unavailable";
  document.querySelector("#collection-description").textContent = "Room310 could not open this collection right now.";
  grid.dataset.loadError = "true";
  grid.replaceChildren();
  const failure = document.createElement("div");
  failure.className = "collection-empty";
  const title = document.createElement("strong");
  title.textContent = "Collection unavailable";
  const copy = document.createElement("p");
  copy.textContent = messageFor(error, "This game collection could not be loaded.");
  failure.append(title, copy);
  grid.append(failure);
  count.textContent = "Unavailable";
});
