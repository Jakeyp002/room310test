import { configurationMessage, isConfigured, messageFor, supabase } from "./supabase-client.js";
import { gameFromRow } from "./game-utils.js";

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
  type.textContent = "External game";
  meta.append(year, type);
  const title = document.createElement("h2");
  title.textContent = game.title;
  const description = document.createElement("p");
  description.textContent = game.description;
  const link = document.createElement("a");
  link.href = game.externalUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Play game →";
  body.append(meta, title, description, link);
  article.append(visual, body);
  return article;
}

async function loadGames() {
  if (!isConfigured) throw new Error(configurationMessage);
  const { data, error } = await supabase
    .from("games")
    .select("id,title,slug,description,year,status,host_type,external_url,thumbnail_path,bundle_path,created_at,updated_at")
    .order("year", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  if (!data?.length) return;

  const games = await Promise.all(
    data.map(async (row) => {
      const game = gameFromRow(row);
      if (!game.thumbnailPath) return { ...game, thumbnailUrl: "" };
      const { data: signed } = await supabase.storage.from("game-thumbnails").createSignedUrl(game.thumbnailPath, 3600);
      return { ...game, thumbnailUrl: signed?.signedUrl || "" };
    })
  );
  container.classList.add("games-list-populated");
  container.replaceChildren(...games.map(makeCard));
  heroCopy.textContent = "Play browser games and interactive projects selected for Room310.";
}

loadGames().catch((error) => {
  container.dataset.loadError = "true";
  const status = container.querySelector("p");
  if (status) status.textContent = messageFor(error, "Games could not be loaded right now.");
});
