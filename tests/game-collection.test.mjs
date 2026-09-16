import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertPreparedMatchesManifest, validateImportManifest } from "../scripts/import-game-collection.mjs";
import { prepareOvo2, prepareStickmanHook } from "../scripts/prepare-pilot-games.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("the native collection has a routed searchable Room310 page", async () => {
  const [page, script, netlify, build] = await Promise.all([
    read("../room310files/game-collection.html"),
    read("../client-src/game-collection.js"),
    read("../netlify.toml"),
    read("../scripts/build.mjs")
  ]);
  assert.match(page, /id="collection-search"/);
  assert.match(page, /id="collection-games"/);
  assert.match(script, /\.from\("game_collections"\)/);
  assert.match(script, /\.eq\("collection_id", collection\.id\)/);
  assert.match(script, /replaceChildren/);
  assert.doesNotMatch(script, /innerHTML/);
  assert.match(netlify, /from = "\/games\/collections\/\*"[\s\S]*to = "\/game-collection\.html"/);
  assert.match(build, /"game-collection": "client-src\/game-collection\.js"/);
});

test("the standalone review tool uses the production sandbox and includes an escape probe", async () => {
  const preview = await read("../scripts/preview-standalone-import.mjs");
  assert.match(preview, /setAttribute\("sandbox","allow-scripts allow-pointer-lock"\)/);
  assert.match(preview, /setAttribute\("allow","fullscreen; gamepad"\)/);
  assert.doesNotMatch(preview, /allow-same-origin|allow-top-navigation|allow-popups|allow-downloads/);
  assert.match(preview, /parent\.document\.body\.dataset\.compromised/);
  assert.match(preview, /PASS: the game could not reach the parent DOM, session, or top-level navigation/);
});

test("the pilot manifest identifies all 15 games and requires provenance", async () => {
  const manifest = JSON.parse(await read("../game-imports/100-games-pilot.json"));
  assert.equal(manifest.games.length, 15);
  assert.equal(validateImportManifest(manifest).games.length, 15);
  assert.equal(manifest.permission.sourceOwner, "Shea O'Neil");
  assert.equal(manifest.permission.suppliedInConversation, true);
  for (const game of manifest.games) {
    assert.match(game.source, /^(?:prepared\/)?html\/[a-z0-9-]+\.html$/);
    assert.match(game.cover, /^covers\/[a-z0-9-]+\.png$/);
    assert.match(game.sourceSha256, /^[a-f0-9]{64}$/);
    assert.ok(game.sourceBytes > 0);
    assert.ok(game.sourcePackage);
    assert.ok(game.sourceEntry);
    if (game.originalSourceSha256) {
      assert.match(game.originalSourceSha256, /^[a-f0-9]{64}$/);
      assert.ok(game.originalSourceBytes > 0);
      assert.ok(game.compatibilityPreparation);
    }
  }
});

test("compatibility preparation fails closed when a supplied game layout changes", () => {
  assert.throws(() => prepareOvo2("<html></html>"), /layout changed/);
  assert.throws(() => prepareStickmanHook("<html><head></head></html>"), /layout changed/);
});

test("Stickman compatibility uses a no-storage cookie shim without weakening the sandbox", () => {
  const original = '<html><head><\/head><script>a = window[n[16]][n[15]];\n            if ((a = a[n[19]](n[18])[1][n[6]](n[17], n[1]))<\/script><\/html>';
  const prepared = prepareStickmanHook(original);
  assert.match(prepared, /data-room310-compatibility="opaque-cookie-shim"/);
  assert.match(prepared, /get:function\(\)\{return ""\}/);
  assert.doesNotMatch(prepared, /allow-same-origin|allow-top-navigation|allow-popups/);
});

test("the importer rejects source files that do not match recorded provenance", () => {
  const game = { title: "2048", sourceBytes: 10, sourceSha256: "a".repeat(64) };
  assert.doesNotThrow(() => assertPreparedMatchesManifest(game, { bytes: 10, sha256: "a".repeat(64) }));
  assert.throws(() => assertPreparedMatchesManifest(game, { bytes: 11, sha256: "a".repeat(64) }), /byte size/);
  assert.throws(() => assertPreparedMatchesManifest(game, { bytes: 10, sha256: "b".repeat(64) }), /SHA-256/);
});
