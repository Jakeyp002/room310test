import { configurationMessage, isConfigured, messageFor, supabase } from "./supabase-client.js";
import { parseDesmosGraph } from "./graph-utils.js";

const title = document.querySelector("#graph-title");
const description = document.querySelector("#graph-description");
const notice = document.querySelector("#graph-notice");
const stage = document.querySelector("#graph-stage");
const reload = document.querySelector("#graph-reload");

async function load() {
  if (!isConfigured) throw new Error(configurationMessage);
  const slug = decodeURIComponent(location.pathname.split("/")[2] || new URLSearchParams(location.search).get("slug") || "");
  if (!/^[a-z0-9][a-z0-9-]{0,69}$/.test(slug)) throw new Error("This graph link is incomplete. Choose a graph from All graphs.");
  const { data, error } = await supabase.from("graphs")
    .select("title,description,desmos_url").eq("slug", slug).eq("status", "published").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("This graph is not available. It may still be a draft or have been unpublished.");
  const { embedUrl } = parseDesmosGraph(data.desmos_url);
  title.textContent = data.title;
  document.title = `${data.title} · Room310 Graphs`;
  description.textContent = data.description;
  const iframe = document.createElement("iframe");
  iframe.title = `Interactive Desmos graph: ${data.title}`;
  iframe.src = embedUrl;
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  // The cross-origin calculator owns its loading indicator. Its load event may
  // wait on unrelated resources even after the graph is already interactive.
  notice.hidden = true;
  reload.addEventListener("click", () => { iframe.src = embedUrl; });
  stage.replaceChildren(iframe);
  stage.hidden = false;
  reload.hidden = false;
  document.querySelector("#graph-hint").hidden = false;
}

load().catch(error => {
  title.textContent = "Graph unavailable";
  notice.textContent = messageFor(error);
});
