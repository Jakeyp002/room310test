import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const courses = ["python", "java", "cpp", "sql", "javascript", "csharp"];
const css = await read("../room310files/style.css");

test("all language course pages include a distinct code cover", async () => {
  for (const course of courses) {
    const page = await read(`../room310files/${course}-study.html`);
    assert.match(page, /class="study-hero[^\"]*language-study-hero/);
    assert.match(page, /class="language-cover" aria-label="[^"]+ code example"/);
    assert.match(page, /class="language-code"/);
    assert.match(page, /class="language-mark" aria-hidden="true"/);
  }
});

test("language covers adapt without clipping and keep readable contrast", () => {
  assert.match(css, /\.language-cover[\s\S]*grid-template-columns: minmax\(0, 1fr\) 190px/);
  assert.match(css, /\.language-code pre[^{]*\{[^}]*overflow: auto/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.language-cover[^}]*grid-template-columns: 1fr/);
  assert.match(css, /color: #e8eef8;[\s\S]*background: #111827/);
});
