import test from "node:test";
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import { loadStandaloneHtml, MAX_STANDALONE_BYTES, prepareStandaloneFile, scanStandaloneHtml } from "../client-src/standalone-game.js";

test("standalone HTML is normalized, hashed, and prepared for private storage", async () => {
  const source = "<!doctype html><canvas id=game></canvas>";
  const result = await prepareStandaloneFile(new File([source], "game.html", { type: "text/html" }));
  assert.equal(result.html, source);
  assert.equal(result.bytes, new TextEncoder().encode(source).byteLength);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.uploadFile.name, `standalone-${result.sha256}.html`);
  assert.equal(result.uploadFile.type, "text/html");
});

test("a ZIP with exactly one self-contained HTML file is accepted", async () => {
  const zipped = zipSync({ "folder/index.htm": strToU8("<canvas></canvas>") });
  const result = await prepareStandaloneFile(new File([zipped], "game.zip", { type: "application/zip" }));
  assert.equal(result.html, "<canvas></canvas>");
  await assert.rejects(() => prepareStandaloneFile(new File([new Uint8Array(MAX_STANDALONE_BYTES + 1)], "huge.html", { type: "text/html" })), /30 MB/);
});

test("multi-file and traversal ZIPs are rejected before publication", async () => {
  const multi = zipSync({ "index.html": strToU8("game"), "asset.js": strToU8("bad") });
  await assert.rejects(() => prepareStandaloneFile(new File([multi], "multi.zip", { type: "application/zip" })), /exactly one/);
  const traversal = zipSync({ "../index.html": strToU8("game") });
  await assert.rejects(() => prepareStandaloneFile(new File([traversal], "traversal.zip", { type: "application/zip" })), /unsafe/);
});

test("static scan reports capabilities that need administrator review", () => {
  const findings = scanStandaloneHtml('<script>parent.document.body.textContent="x";navigator.serviceWorker.register("sw.js");fetch("https://tracker.test")</script>');
  assert.deepEqual(findings, ["Parent-page access", "Service worker registration", "Remote network access"]);
});

test("published standalone HTML is fetched using a short-lived signed URL", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://storage.test/signed");
    assert.equal(options.credentials, "omit");
    assert.equal(options.referrerPolicy, "no-referrer");
    return new Response("<!doctype html><p>ready</p>", { status: 200, headers: { "content-length": "32" } });
  };
  const client = { storage: { from(bucket) { assert.equal(bucket, "game-standalone"); return { async createSignedUrl(path, seconds) { assert.equal(path, "7/standalone-hash.html"); assert.equal(seconds, 300); return { data: { signedUrl: "https://storage.test/signed" }, error: null }; } }; } } };
  try {
    assert.match(await loadStandaloneHtml(client, "7/standalone-hash.html"), /ready/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
