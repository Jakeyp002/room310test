import { parseDesmosGraph } from "./graph-utils.js";

const frame = document.querySelector("#graph-viewer-frame");
const status = document.querySelector("#graph-viewer-status");
const title = document.querySelector("#graph-viewer-title");
const source = document.querySelector("#graph-viewer-source");

function fail(message) {
  status.textContent = message;
  status.hidden = false;
  frame.hidden = true;
}

function decodePayload() {
  const encoded = new URLSearchParams(location.hash.slice(1)).get("graph");
  if (!encoded || encoded.length > 40_000) throw new Error("This graph link is missing or too large.");
  const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function validPayload(payload) {
  return payload && /^[a-zA-Z0-9_-]{16,100}$/.test(payload.apiKey || "")
    && Array.isArray(payload.expressions) && payload.expressions.length >= 1 && payload.expressions.length <= 32
    && payload.expressions.every((expression) => typeof expression?.latex === "string" && expression.latex.trim()
      && expression.latex.length <= 500
      && (expression.color === undefined || /^#[0-9a-f]{6}$/i.test(expression.color))
      && (expression.hidden === undefined || typeof expression.hidden === "boolean"))
    && payload.bounds && ["left", "right", "bottom", "top"].every((key) => Number.isFinite(payload.bounds[key]) && Math.abs(payload.bounds[key]) <= 1_000_000)
    && payload.bounds.right > payload.bounds.left && payload.bounds.top > payload.bounds.bottom;
}

try {
  const payload = decodePayload();
  if (!validPayload(payload)) throw new Error("This graph link contains invalid graph data.");
  title.textContent = typeof payload.title === "string" && payload.title.trim()
    ? payload.title.trim().slice(0, 200)
    : "Interactive graph";
  document.title = `${title.textContent} · Room310`;
  if (payload.sourceUrl) {
    const graph = parseDesmosGraph(payload.sourceUrl);
    source.href = graph.url;
    source.hidden = false;
  }
  frame.addEventListener("load", () => {
    frame.contentWindow?.postMessage({
      type: "room310-graph",
      apiKey: payload.apiKey,
      expressions: payload.expressions,
      bounds: payload.bounds
    }, "*");
    status.hidden = true;
  }, { once: true });
} catch (error) {
  fail(error instanceof Error ? error.message : "This graph could not be opened.");
}
