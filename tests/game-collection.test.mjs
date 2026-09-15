import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateImportManifest } from "../scripts/import-game-collection.mjs";

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

test("the pilot manifest identifies all 15 games and requires provenance", async () => {
  const manifest = JSON.parse(await read("../game-imports/100-games-pilot.json"));
  assert.equal(manifest.games.length, 15);
  assert.throws(() => validateImportManifest(manifest), /permission note/);
  manifest.permission = { sourceOwner: "Authorized Room310 member", note: "Room310 may republish these supplied files." };
  assert.equal(validateImportManifest(manifest).games.length, 15);
});
