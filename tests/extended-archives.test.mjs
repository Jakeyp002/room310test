import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const page = await read("../room310files/extended-archives.html");
const home = await read("../room310files/index.html");
const css = await read("../room310files/extended-archives.css");

test("Extended Archives displays the construction notice instead of draft content", () => {
  assert.match(page, /<h1>Under<br \/>construction\.<\/h1>/);
  assert.doesNotMatch(page, /math-shelf|bulletin-post|archive is open/);
  assert.match(page, /class="construction-tapes" aria-hidden="true"/);
  assert.equal((page.match(/class="construction-tape"/g) || []).length, 2);
  assert.match(css, /rotate\(-10deg\)/);
  assert.match(css, /rotate\(10deg\)/);
  assert.match(css, /pointer-events: none/);
});

test("the interested invitation links to the existing Room310 staff section", () => {
  assert.match(page, /class="construction-contact" href="\/index.html#contributors"/);
  assert.match(page, /Interested\?/);
  assert.match(page, /Talk to the Room310 owners/);
  assert.match(home, /<section class="section" id="contributors">/);
  assert.match(home, /Founder\/President/);
  assert.match(home, /Jacob Aleo/);
});

test("the current release does not accidentally publish the held admin-request feature", async () => {
  const polish = await read("../room310files/site-polish.js");
  const version = JSON.parse(await read("../package.json")).version.split(".").slice(0, 2).join(".");
  assert.ok(polish.includes(`version.textContent = "v${version}"`));
  assert.doesNotMatch(polish, /admin-request-link/);
  assert.doesNotMatch(await read("../netlify.toml"), /\/admin\/request/);
  await assert.rejects(access(new URL("../room310files/admin-request.html", import.meta.url)), { code: "ENOENT" });
});
