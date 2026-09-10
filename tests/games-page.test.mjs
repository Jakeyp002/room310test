import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const page = await read("../room310files/games.html");
const script = await read("../room310files/game-embed.js");
const css = await read("../room310files/style.css");

test("Games embeds Apex Trails with a restricted fallback-friendly frame", () => {
  assert.match(page, /id="apex-trails-frame"/);
  assert.match(page, /src="https:\/\/oneshotstudios\.org\/"/);
  assert.match(page, /sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock"/);
  assert.doesNotMatch(page, /allow-top-navigation|allow-popups|clipboard-read|clipboard-write/);
  assert.match(page, /referrerpolicy="no-referrer"/);
  assert.match(page, /Open separately/);
  assert.match(page, /data-game-state hidden/);
});

test("Apex Trails supplies accessible fullscreen behavior and responsive layout", () => {
  assert.match(script, /requestFullscreen/);
  assert.match(script, /aria-pressed/);
  assert.match(script, /fullscreenchange/);
  assert.match(script, /mode: "no-cors"/);
  assert.match(script, /frame\.hidden = true/);
  assert.match(script, /Apex Trails is currently unavailable/);
  assert.match(css, /\.featured-game-frame/);
  assert.match(css, /iframe:fullscreen/);
  assert.match(css, /68svh/);
});
