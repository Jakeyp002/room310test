import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extractDesmosGraphFromText, parseDesmosGraph, graphPageUrl, safeLoginDestination } from "../client-src/graph-utils.js";

test("Desmos imports accept share links and iframe code without executing markup", () => {
  const expected = { id: "fmxds1uvhe", url: "https://www.desmos.com/calculator/fmxds1uvhe", embedUrl: "https://www.desmos.com/calculator/fmxds1uvhe" };
  for (const source of [expected.url, "desmos.com/calculator/fmxds1uvhe/", `${expected.url}?embed#abc`, `<iframe src='${expected.url}?embed&amp;foo=bar' width='500'></iframe>`]) assert.deepEqual(parseDesmosGraph(source), expected);
});

test("Desmos imports reject unsafe hosts, protocols, unsaved graphs and non-graph sources", () => {
  for (const source of ["", "javascript:alert(1)", "http://www.desmos.com/calculator/fmxds1uvhe", "https://desmos.com.evil.test/calculator/fmxds1uvhe", "https://www.desmos.com@evil.test/calculator/fmxds1uvhe", "https://admin@desmos.com/calculator/fmxds1uvhe", "https://www.desmos.com:8443/calculator/fmxds1uvhe", "https://www.desmos.com/calculator", "https://www.desmos.com/3d/fmxds1uvhe", "<iframe onload='alert(1)'></iframe>", "x".repeat(4097)]) assert.throws(() => parseDesmosGraph(source));
});

test("Helper finds a saved Desmos link inside a natural-language question", () => {
  assert.equal(extractDesmosGraphFromText("Can you explain https://www.desmos.com/calculator/fmxds1uvhe?lang=en#test please?").url, "https://www.desmos.com/calculator/fmxds1uvhe");
  assert.equal(extractDesmosGraphFromText("Look at desmos.com/calculator/fmxds1uvhe and tell me the vertex").id, "fmxds1uvhe");
  for (const source of ["No graph here", "https://evil.test/calculator/fmxds1uvhe", "https://www.desmos.com/3d/fmxds1uvhe"]) {
    assert.equal(extractDesmosGraphFromText(source), null);
  }
});

test("graph navigation stays on Room310 and login return paths are allowlisted", () => {
  assert.equal(graphPageUrl("parabolas-123"), "/graphs/parabolas-123");
  assert.equal(safeLoginDestination("?next=%2Fadmin%2Fgraphs"), "/admin/graphs");
  for (const query of ["", "?next=https://evil.test", "?next=//evil.test", "?next=/admin/graphs/../../evil"]) assert.equal(safeLoginDestination(query), "/admin/games");
});

test("existing-password sign-in has no account-creation length rule", async () => {
  const html = await readFile(new URL("../room310files/admin-login.html", import.meta.url), "utf8");
  const password = html.match(/<input[^>]*type="password"[^>]*>/)[0];
  assert.match(password, /autocomplete="current-password"/);
  assert.doesNotMatch(password, /minlength|maxlength/);
});
