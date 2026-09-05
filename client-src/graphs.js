import { configurationMessage, isConfigured, messageFor, supabase } from "./supabase-client.js";
import { graphPageUrl } from "./graph-utils.js";

const list = document.querySelector("#graphs-list");

function card(graph, cover) {
  const article = document.createElement("article");
  article.className = "public-game-card public-graph-card";
  const visual = document.createElement("a");
  visual.className = "public-game-cover";
  visual.href = graphPageUrl(graph.slug);
  visual.setAttribute("aria-label", `Open ${graph.title}`);
  visual.textContent = "↗";
  if (cover) {
    const img = document.createElement("img");
    img.src = cover;
    img.alt = `Preview of ${graph.title}`;
    img.loading = "lazy";
    img.addEventListener("error", () => visual.replaceChildren(document.createTextNode("↗")));
    visual.replaceChildren(img);
  }
  const body = document.createElement("div");
  body.className = "public-game-body";
  const meta = document.createElement("div");
  meta.className = "public-game-meta";
  for (const text of [graph.year, "Interactive graph"]) {
    const span = document.createElement("span");
    span.textContent = text;
    meta.append(span);
  }
  const title = document.createElement("h2");
  title.textContent = graph.title;
  const description = document.createElement("p");
  description.textContent = graph.description;
  const link = document.createElement("a");
  link.href = graphPageUrl(graph.slug);
  link.textContent = "Explore graph →";
  body.append(meta, title, description, link);
  article.append(visual, body);
  return article;
}

async function load() {
  if (!isConfigured) throw new Error(configurationMessage);
  const { data, error } = await supabase.from("graphs")
    .select("title,slug,description,year,thumbnail_path")
    .eq("status", "published")
    .order("year", { ascending: false }).order("created_at", { ascending: false });
  if (error) throw error;
  if (!data.length) {
    list.querySelector("h2").textContent = "Graphs are on their way.";
    list.querySelector("p").textContent = "Published graphs will appear here, ready to explore without leaving Room310.";
    return;
  }
  const cards = await Promise.all(data.map(async graph => {
    const { data: cover } = await supabase.storage.from("graph-thumbnails").createSignedUrl(graph.thumbnail_path, 3600);
    return card(graph, cover?.signedUrl);
  }));
  list.classList.add("games-list-populated");
  list.replaceChildren(...cards);
}

load().catch(error => {
  list.querySelector("h2").textContent = "Graphs could not load.";
  list.querySelector("p").textContent = messageFor(error);
});
