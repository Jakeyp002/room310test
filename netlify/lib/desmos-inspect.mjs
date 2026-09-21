import { extractDesmosGraphFromText, parseDesmosGraph } from "../../client-src/graph-utils.js";

// Shared by the Study AI function without becoming a public Netlify endpoint.

const MAX_PAGE_BYTES = 1_000_000;
const MAX_STATE_BYTES = 2_000_000;
const MAX_CONTEXT_ITEMS = 80;
const MAX_RENDER_EXPRESSIONS = 32;

const decodeHtml = (value) => value
  .replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">");

async function limitedBody(response, limit) {
  if (Number(response.headers.get("content-length")) > limit) throw new Error("That Desmos graph is too large for the Helper to inspect.");
  if (!response.body) throw new Error("Desmos returned an empty graph.");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error("That Desmos graph is too large for the Helper to inspect.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function safeStateUrl(value, expectedId) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Desmos did not provide a readable saved graph."); }
  const match = url.pathname.match(/^\/calc-states\/production\/([a-zA-Z0-9_-]{6,80})$/);
  if (url.protocol !== "https:" || url.hostname !== "www.desmos.com" || url.port || url.username || url.password
    || url.search || url.hash || !match || match[1] !== expectedId) {
    throw new Error("Desmos returned an unsupported saved graph location.");
  }
  return url.href;
}

export function graphStateReferenceFromHtml(html, expectedId) {
  const body = String(html || "").match(/<body\b[^>]*\bdata-load-data\s*=\s*(["'])([\s\S]*?)\1/i);
  if (!body) throw new Error("This Desmos link does not contain a saved graph the Helper can inspect.");
  let loadData;
  try { loadData = JSON.parse(decodeHtml(body[2])); } catch { throw new Error("Desmos returned unreadable graph information."); }
  const graph = loadData?.graph;
  if (!graph || graph.hash !== expectedId || (graph.product && graph.product !== "graphing")) {
    throw new Error("Use a saved link from the Desmos Graphing Calculator.");
  }
  return {
    title: typeof graph.title === "string" && graph.title.trim() ? graph.title.trim().slice(0, 200) : "Untitled Desmos graph",
    stateUrl: safeStateUrl(graph.stateUrl, expectedId)
  };
}

function cleanText(value, limit) {
  return typeof value === "string" ? value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").trim().slice(0, limit) : "";
}

function viewportFromState(state) {
  const viewport = state?.graph?.viewport;
  const values = [viewport?.xmin, viewport?.xmax, viewport?.ymin, viewport?.ymax];
  if (values.every((value) => Number.isFinite(value) && Math.abs(value) <= 1_000_000)
    && viewport.xmax - viewport.xmin >= 0.000001 && viewport.ymax - viewport.ymin >= 0.000001) {
    return { left: viewport.xmin, right: viewport.xmax, bottom: viewport.ymin, top: viewport.ymax };
  }
  return { left: -10, right: 10, bottom: -10, top: 10 };
}

function tableSummary(item) {
  if (!Array.isArray(item?.columns)) return "";
  const columns = item.columns.slice(0, 8).map((column) => {
    const latex = cleanText(column?.latex, 160) || "unnamed";
    const values = Array.isArray(column?.values)
      ? column.values.slice(0, 30).map((value) => cleanText(String(value ?? ""), 80)).filter(Boolean)
      : [];
    return `${latex}: [${values.join(", ")}]`;
  });
  return columns.length ? `Table — ${columns.join("; ")}` : "";
}

export function summarizeDesmosState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("Desmos returned an unreadable graph state.");
  const list = state?.expressions?.list;
  if (!Array.isArray(list)) throw new Error("The saved Desmos graph has no readable expression list.");
  const expressions = [];
  const context = [];
  for (const item of list.slice(0, 400)) {
    const latex = cleanText(item?.latex, 500);
    if (latex) {
      if (expressions.length < MAX_RENDER_EXPRESSIONS) {
        const expression = { latex };
        if (/^#[0-9a-f]{6}$/i.test(item?.color || "")) expression.color = item.color;
        if (item?.hidden === true) expression.hidden = true;
        expressions.push(expression);
      }
      if (context.length < MAX_CONTEXT_ITEMS) context.push(`Expression: ${latex}`);
      continue;
    }
    const note = cleanText(item?.text, 800);
    if (note && context.length < MAX_CONTEXT_ITEMS) context.push(`Note: ${note}`);
    const table = tableSummary(item);
    if (table && context.length < MAX_CONTEXT_ITEMS) context.push(table);
  }
  if (!context.length) throw new Error("The saved Desmos graph does not contain readable equations, notes, or table data.");
  return { expressions, bounds: viewportFromState(state), context };
}

export async function inspectDesmosGraph(source, fetcher = fetch) {
  const graph = typeof source === "string" && source.includes(" ")
    ? extractDesmosGraphFromText(source)
    : parseDesmosGraph(source);
  if (!graph) throw new Error("Paste a saved Desmos graph link for the Helper to inspect.");
  const signal = AbortSignal.timeout(15_000);
  const pageResponse = await fetcher(graph.url, { redirect: "error", signal });
  if (!pageResponse.ok) throw new Error("Desmos could not open that graph. Check that its share link works.");
  const reference = graphStateReferenceFromHtml(await limitedBody(pageResponse, MAX_PAGE_BYTES), graph.id);
  const stateResponse = await fetcher(reference.stateUrl, { redirect: "error", signal });
  if (!stateResponse.ok) throw new Error("Desmos could not load the saved equations for that graph.");
  let state;
  try { state = JSON.parse(await limitedBody(stateResponse, MAX_STATE_BYTES)); } catch (error) {
    if (error?.message?.includes("too large")) throw error;
    throw new Error("Desmos returned an unreadable saved graph.");
  }
  return { url: graph.url, title: reference.title, ...summarizeDesmosState(state) };
}
