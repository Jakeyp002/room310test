import test from "node:test";
import assert from "node:assert/strict";
import { graphStateReferenceFromHtml, inspectDesmosGraph, summarizeDesmosState } from "../netlify/lib/desmos-inspect.mjs";

const id = "fmxds1uvhe";
const graphUrl = `https://www.desmos.com/calculator/${id}`;
const stateUrl = `https://www.desmos.com/calc-states/production/${id}`;
const loadData = JSON.stringify({ graph: { hash: id, title: "Vertex & sliders", stateUrl, product: "graphing" } })
  .replaceAll("&", "&amp;").replaceAll('"', "&quot;");
const page = `<!doctype html><body class="calculator" data-load-data="${loadData}"></body>`;
const state = {
  graph: { viewport: { xmin: -8, xmax: 12, ymin: -6, ymax: 14 } },
  expressions: {
    list: [
      { id: "1", latex: "y=a(x-h)^2+k", color: "#c74440" },
      { id: "2", latex: "a=2", hidden: true },
      { id: "3", text: "Move the sliders to compare vertex form." },
      { id: "4", type: "table", columns: [{ latex: "x_1", values: ["1", "2"] }, { latex: "y_1", values: ["3", "5"] }] }
    ]
  }
};

test("saved Desmos HTML exposes only a matching official state document", () => {
  assert.deepEqual(graphStateReferenceFromHtml(page, id), { title: "Vertex & sliders", stateUrl });
  for (const malicious of [
    { hash: id, stateUrl: "http://www.desmos.com/calc-states/production/fmxds1uvhe", product: "graphing" },
    { hash: id, stateUrl: "https://evil.test/calc-states/production/fmxds1uvhe", product: "graphing" },
    { hash: id, stateUrl: "https://www.desmos.com/calc-states/production/another12", product: "graphing" },
    { hash: id, stateUrl, product: "geometry" }
  ]) {
    const encoded = JSON.stringify({ graph: malicious }).replaceAll('"', "&quot;");
    assert.throws(() => graphStateReferenceFromHtml(`<body data-load-data="${encoded}">`, id));
  }
});

test("Desmos state is reduced to safe equations, viewport, notes, and table context", () => {
  const result = summarizeDesmosState(state);
  assert.deepEqual(result.bounds, { left: -8, right: 12, bottom: -6, top: 14 });
  assert.deepEqual(result.expressions, [
    { latex: "y=a(x-h)^2+k", color: "#c74440" },
    { latex: "a=2", hidden: true }
  ]);
  assert.ok(result.context.some((item) => item.startsWith("Note: Move the sliders")));
  assert.ok(result.context.some((item) => item.includes("Table — x_1: [1, 2]")));
  assert.throws(() => summarizeDesmosState({ expressions: { list: [] } }), /does not contain readable/);
});

test("graph inspection fetches only the canonical graph and its validated state without redirects", async () => {
  const calls = [];
  const result = await inspectDesmosGraph(`Please explain ${graphUrl}`, async (url, options) => {
    calls.push(String(url));
    assert.equal(options.redirect, "error");
    assert.ok(options.signal);
    if (url === graphUrl) return new Response(page);
    if (url === stateUrl) return Response.json(state);
    return new Response("not found", { status: 404 });
  });
  assert.deepEqual(calls, [graphUrl, stateUrl]);
  assert.equal(result.title, "Vertex & sliders");
  assert.equal(result.url, graphUrl);
  assert.equal(result.expressions.length, 2);
});
