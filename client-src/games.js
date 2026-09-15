import { configurationMessage, isConfigured, messageFor, supabase } from "./supabase-client.js";
import { collectionPlayUrl, gameFromRow, gamePlayUrl, isApexTrailsUrl } from "./game-utils.js";

const container = document.querySelector(".games-list");
const heroCopy = document.querySelector(".games-hero > p");

function makeCard(game, index) {
  const article = document.createElement("article");
  article.className = "public-game-card";
  const visual = document.createElement("div");
  visual.className = "public-game-cover";
  if (game.thumbnailUrl) {
    const image = document.createElement("img");
    image.src = game.thumbnailUrl;
    image.alt = `Cover artwork for ${game.title}`;
    image.loading = "lazy";
    visual.append(image);
  } else {
    const number = document.createElement("span");
    number.textContent = String(index + 1).padStart(2, "0");
    visual.append(number);
  }
  const body = document.createElement("div");
  body.className = "public-game-body";
  const meta = document.createElement("div");
  meta.className = "public-game-meta";
  const year = document.createElement("span");
  year.textContent = game.year;
  const type = document.createElement("span");
  type.textContent = game.hostType === "hosted" ? "Hosted ZIP" : game.hostType === "embed" ? "Pasted HTML" : "Linked game";
  meta.append(year, type);
  const title = document.createElement("h2");
  title.textContent = game.title;
  const description = document.createElement("p");
  description.textContent = game.description;
  const link = document.createElement("a");
  if (game.hostType === "external" && isApexTrailsUrl(game.externalUrl)) {
    link.href = "#apex-trails";
    link.textContent = "Play in Room310 →";
    link.addEventListener("click", () => {
      document.querySelector("#apex-trails-frame")?.focus({ preventScroll: true });
    });
  } else {
    link.href = gamePlayUrl(game);
    link.textContent = "Play game →";
  }
  body.append(meta, title, description, link);
  article.append(visual, body);
  return article;
}

function makeCollectionCard(collection, count, index) {
  const article = document.createElement("article");
  article.className = "public-game-card public-collection-card";
  const visual = document.createElement("div");
  visual.className = "public-game-cover public-collection-cover";
  const countLabel = document.createElement("strong");
  countLabel.textContent = `${count}+`;
  const countCopy = document.createElement("span");
  countCopy.textContent = "games";
  visual.append(countLabel, countCopy);
  const body = document.createElement("div");
  body.className = "public-game-body";
  const meta = document.createElement("div");
  meta.className = "public-game-meta";
  const label = document.createElement("span");
  label.textContent = "Room310 collection";
  const total = document.createElement("span");
  total.textContent = `${count} available`;
  meta.append(label, total);
  const title = document.createElement("h2");
  title.textContent = collection.title;
  const description = document.createElement("p");
  description.textContent = collection.description;
  const link = document.createElement("a");
  link.href = collectionPlayUrl(collection);
  link.textContent = "Browse collection →";
  body.append(meta, title, description, link);
  article.append(visual, body);
  article.style.setProperty("--collection-index", index);
  return article;
}

async function loadGames() {
  if (!isConfigured) throw new Error(configurationMessage);
  const [{ data, error }, { data: collectionRows, error: collectionError }] = await Promise.all([
    supabase
      .from("games")
      .select("id,title,slug,description,year,status,host_type,external_url,thumbnail_path,bundle_path,collection_id,created_at,updated_at")
      .is("collection_id", null)
      .order("year", { ascending: false })
      .order("created_at", { ascending: false }),
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
  if (!data?.length && !collections.length) return;

  const games = await Promise.all(
    data.map(async (row) => {
      const game = gameFromRow(row);
      if (!game.thumbnailPath) return { ...game, thumbnailUrl: "" };
      const { data: signed } = await supabase.storage.from("game-thumbnails").createSignedUrl(game.thumbnailPath, 3600);
      return { ...game, thumbnailUrl: signed?.signedUrl || "" };
    })
  );
  container.classList.add("games-list-populated");
  const collectionCards = collections.map((collection, index) => makeCollectionCard(collection, counts.get(collection.id) || 0, index));
  container.replaceChildren(...collectionCards, ...games.map((game, index) => makeCard(game, index + collectionCards.length)));
  heroCopy.textContent = "Play browser games and interactive projects selected for Room310.";
}

loadGames().catch((error) => {
  container.dataset.loadError = "true";
  const status = container.querySelector("p");
  if (status) status.textContent = messageFor(error, "Games could not be loaded right now.");
});
