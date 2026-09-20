import { configurationMessage, isConfigured, messageFor, supabase } from "./supabase-client.js";
import { gameFromRow, gamePlayUrl } from "./game-utils.js";

const grid = document.querySelector("#collection-games");
const search = document.querySelector("#collection-search");
const count = document.querySelector("#collection-count");
let games = [];

const coverEmoji = new Map([
  ["2048", "🔢"], ["2048-cupcakes", "🧁"], ["angrybirds", "🐦"], ["bitplanes", "✈️"],
  ["bloxorz", "🧱"], ["bubbleshooter", "🫧"], ["chess", "♟️"], ["doodlejump", "👽"],
  ["ducklife", "🦆"], ["ducklife-2", "🦆"], ["ducklife-5", "🦆"], ["earntodie", "🚙"],
  ["earntodie-2", "🧟"], ["flappybird", "🐤"], ["floodrunner-2", "🏃"], ["floodrunner-4", "🌊"],
  ["fruitninja", "🍉"], ["geometrydash", "🔷"], ["getaway-shootout", "🔫"], ["hole-io", "🕳️"],
  ["ironsnout", "🐷"], ["minesweeper", "💣"], ["monkey-mart", "🐒"], ["oppositeday", "🔄"],
  ["ovo-2", "🏃"], ["pacman", "🟡"], ["papasburgeria", "🍔"], ["paper-io-2", "🗺️"],
  ["redball-4-vol-2", "🔴"], ["redball-4-vol-3", "🔴"], ["retro-bowl", "🏈"], ["retrohighway", "🏍️"],
  ["run", "🏃"], ["run-2", "🏃"], ["sandgame", "🏖️"], ["slope", "🟢"],
  ["snow-rider", "🛷"], ["soccer-random", "⚽"], ["spaceiskey", "🔑"], ["spaceiskey-2", "🚀"],
  ["stack", "🏗️"], ["stickmerge", "🎯"], ["stickman-hook", "🪝"], ["thisistheonlyleveltoo", "🐘"],
  ["timeshooter-2", "⏱️"], ["timeshooter-3", "⌛"], ["tomb-of-the-mask", "🎭"], ["trapthecat", "🐈"],
  ["tunnel-rush", "🌀"], ["vex-6", "🏃"], ["vex-7", "🤸"], ["vexx-3-m", "🏍️"],
  ["vexx-3-m-2", "🏁"], ["webecomewhatwebehold", "📷"], ["wheely", "🚗"], ["wheely-8", "🛸"]
]);
const coverPalettes = [
  ["#7c3aed", "#22d3ee"], ["#f97316", "#facc15"], ["#ec4899", "#8b5cf6"],
  ["#10b981", "#38bdf8"], ["#ef4444", "#fb7185"], ["#2563eb", "#60a5fa"],
  ["#84cc16", "#facc15"], ["#0f172a", "#475569"]
];

function slugFromPath() {
  return location.pathname.match(/^\/games\/collections\/([a-z0-9][a-z0-9-]{0,69})\/?$/)?.[1] || "";
}

function card(game, index) {
  const article = document.createElement("article");
  article.className = "collection-game-card";
  const cover = document.createElement("div");
  cover.className = "collection-game-cover";
  const researchedEmoji = coverEmoji.get(game.slug);
  if (researchedEmoji) {
    const [start, end] = coverPalettes[index % coverPalettes.length];
    cover.classList.add("collection-game-cover-emoji");
    cover.style.setProperty("--cover-start", start);
    cover.style.setProperty("--cover-end", end);
    const art = document.createElement("span");
    art.className = "collection-game-emoji";
    art.setAttribute("aria-hidden", "true");
    art.textContent = researchedEmoji;
    cover.append(art);
  } else if (game.thumbnailUrl) {
    const image = document.createElement("img");
    image.src = game.thumbnailUrl;
    image.alt = "";
    image.loading = "lazy";
    cover.append(image);
  } else {
    const art = document.createElement("span");
    art.className = "collection-game-emoji";
    art.setAttribute("aria-hidden", "true");
    art.textContent = "🎮";
    cover.append(art);
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
    if (coverEmoji.has(game.slug) || !game.thumbnailPath) return { ...game, thumbnailUrl: "" };
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
