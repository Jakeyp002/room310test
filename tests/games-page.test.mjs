import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const page = await read("../room310files/games.html");
const script = await read("../client-src/games.js");
const css = await read("../room310files/style.css");

test("Games presents a searchable, growing card library", () => {
  assert.match(page, /class="games-library"/);
  assert.match(page, /data-game-search/);
  assert.match(page, /data-games-count/);
  assert.match(page, /aria-live="polite" aria-busy="true"/);
  assert.match(page, /More games are on the way/);
  assert.match(css, /repeat\(auto-fill, minmax/);
  assert.match(css, /--game-color/);
  assert.match(script, /search\?\.addEventListener\("input"/);
  assert.match(script, /entries\.filter/);
});

test("Game cards keep names, focus treatment, and minimum play targets", () => {
  assert.match(script, /setAttribute\("aria-label", `Play \$\{name\}`\)/);
  assert.match(script, /image\.alt = ""/);
  assert.match(script, /aria-hidden/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /\.public-game-link:focus-visible/);
  assert.match(css, /prefers-reduced-motion: no-preference/);
});
