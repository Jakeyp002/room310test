import { configurationMessage, isConfigured, messageFor, setupPublicAdminAccess, supabase } from "./supabase-client.js";
import { collectionPlayUrl, gameFromRow, gamePlayUrl } from "./game-utils.js";

const container = document.querySelector(".games-list");
const search = document.querySelector("[data-game-search]");
const count = document.querySelector("[data-games-count]");
const status = document.querySelector("[data-games-status]");
setupPublicAdminAccess("/admin/games").catch(() => {});

const colors = ["#8b7cf6", "#4fd1c5", "#ff7a90", "#77d4f5", "#ffad66", "#a8e063", "#5ee6a8", "#62b8ff", "#ffd85a", "#b794f6", "#ff8a5b", "#f687d4"];
const iconRules = [
  [/basket|hoop|sport/i, "🏀"], [/road|drive|car|race/i, "🏎️"], [/trail|mountain|apex/i, "⛰️"],
  [/guess|geo|world/i, "🌍"], [/line|draw|rider/i, "✏️"], [/craft|mine|build/i, "🧱"],
  [/color|match|paint/i, "🎨"], [/appel|apple/i, "🍎"], [/bad time|boss/i, "💀"], [/puzzle/i, "🧩"]
];
let entries = [];

function iconFor(title) {
  return iconRules.find(([pattern]) => pattern.test(title))?.[1] || "🎮";
}

function makeVisual(title, thumbnailUrl, index) {
  const visual = document.createElement("div");
  visual.className = "public-game-cover";
  if (thumbnailUrl) {
    const image = document.createElement("img");
    image.src = thumbnailUrl;
    image.alt = "";
    image.loading = "lazy";
    visual.append(image);
  } else {
    const icon = document.createElement("span");
    icon.className = "public-game-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = iconFor(title);
    visual.append(icon);
  }
  visual.style.setProperty("--game-color", colors[index % colors.length]);
  return visual;
}

function makeCard({ title: name, description: copy, year, thumbnailUrl, slug }, index) {
  const article = document.createElement("article");
  article.className = "public-game-card";
  article.style.setProperty("--game-color", colors[index % colors.length]);
  const visual = makeVisual(name, thumbnailUrl, index);
  const body = document.createElement("div");
  body.className = "public-game-body";
  const title = document.createElement("h3");
  title.textContent = name;
  const description = document.createElement("p");
  description.textContent = copy;
  const meta = document.createElement("div");
  meta.className = "public-game-meta";
  meta.textContent = String(year || "Play now");
  const link = document.createElement("a");
  link.className = "public-game-link";
  link.href = gamePlayUrl({ slug });
  link.setAttribute("aria-label", `Play ${name}`);
  link.innerHTML = '<span>Play</span><span aria-hidden="true">▶</span>';
  body.append(title, description, meta, link);
  article.append(visual, body);
  return article;
}

function makeCollectionCard({ title: name, description: copy, slug }, index) {
  const article = document.createElement("article");
  article.className = "public-game-card public-collection-card";
  article.style.setProperty("--game-color", colors[index % colors.length]);
  const visual = makeVisual(name, "", index);
  visual.querySelector(".public-game-icon").textContent = "🎲";
  const body = document.createElement("div");
  body.className = "public-game-body";
  const title = document.createElement("h3");
  title.textContent = name;
  const description = document.createElement("p");
  description.textContent = copy;
  const meta = document.createElement("div");
  meta.className = "public-game-meta";
  meta.textContent = "Room310 collection";
  const link = document.createElement("a");
  link.className = "public-game-link";
  link.href = collectionPlayUrl({ slug });
  link.setAttribute("aria-label", `Browse ${name}`);
  link.innerHTML = '<span>Browse</span><span aria-hidden="true">▶</span>';
  body.append(title, description, meta, link);
  article.append(visual, body);
  return article;
}

function renderEntries(items) {
  container.replaceChildren(...items.map((entry, index) => entry.kind === "collection" ? makeCollectionCard(entry, index) : makeCard(entry, index)));
  container.setAttribute("aria-busy", "false");
  count.textContent = `${items.length} ${items.length === 1 ? "game" : "games"}`;
  status.textContent = `${items.length} ${items.length === 1 ? "game" : "games"} shown.`;
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "games-empty";
    empty.innerHTML = "<strong>No games found</strong><span>Try another title.</span>";
    container.replaceChildren(empty);
  }
}

async function loadGames() {
  if (!isConfigured) throw new Error(configurationMessage);
  const [{ data, error }, { data: collectionRows, error: collectionError }] = await Promise.all([
    supabase.from("games").select("id,title,slug,description,year,status,host_type,external_url,thumbnail_path,bundle_path,collection_id,created_at,updated_at").is("collection_id", null).order("year", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("game_collections").select("id,title,slug,description,status,created_at").order("created_at", { ascending: false })
  ]);
  if (error) throw error;
  if (collectionError) throw collectionError;
  const collections = collectionRows || [];
  const counts = new Map();
  if (collections.length) {
    const { data: members, error: memberError } = await supabase.from("games").select("collection_id").in("collection_id", collections.map((collection) => collection.id));
    if (memberError) throw memberError;
    for (const member of members || []) counts.set(member.collection_id, (counts.get(member.collection_id) || 0) + 1);
  }
  const games = await Promise.all((data || []).map(async (row) => {
    const game = gameFromRow(row);
    if (!game.thumbnailPath) return { ...game, thumbnailUrl: "", kind: "game" };
    const { data: signed } = await supabase.storage.from("game-thumbnails").createSignedUrl(game.thumbnailPath, 3600);
    return { ...game, thumbnailUrl: signed?.signedUrl || "", kind: "game" };
  }));
  entries = [
    ...collections.map((collection) => ({ ...collection, gameCount: counts.get(collection.id) || 0, kind: "collection" })),
    ...games
  ];
  renderEntries(entries);
}

search?.addEventListener("input", () => {
  const query = search.value.trim().toLocaleLowerCase();
  renderEntries(query ? entries.filter((entry) => `${entry.title} ${entry.description}`.toLocaleLowerCase().includes(query)) : entries);
});

loadGames().catch((error) => {
  container.setAttribute("aria-busy", "false");
  count.textContent = "Unavailable";
  container.innerHTML = '<div class="games-empty"><strong>Games could not be loaded</strong><span>Check your connection and try again.</span></div>';
  status.textContent = messageFor(error, "Games could not be loaded right now.");
});
