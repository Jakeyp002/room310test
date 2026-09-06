import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { parseHTML } from "linkedom";
import vm from "node:vm";
import { lessons } from "../curriculum/deep-learning.mjs";

const base = new URL("../room310files/", import.meta.url);
const read = name => readFile(new URL(name, base), "utf8");

test("deep learning is discoverable from Study and Python, with six ordered lessons", async () => {
  for (const name of ["study.html", "python-study.html"]) {
    const { document } = parseHTML(await read(name));
    assert.ok(document.querySelector('a[href="deep-learning-study.html"]'));
  }
  const { document } = parseHTML(await read("deep-learning-study.html"));
  assert.deepEqual([...document.querySelectorAll(".dl-lesson-card")].map(a => a.getAttribute("href")), lessons.map(l => `${l.slug}.html`));
  assert.equal(lessons.length, 6);
  assert.equal(lessons.flatMap(l => l.assignments).length, 12);
  assert.match(document.body.textContent, /not his course/);
  assert.ok(document.querySelector("svg[role=img] title"));
});

for (const [index, lesson] of lessons.entries()) {
  test(`${lesson.slug}: links, code, runtime, and notebook agree`, async () => {
    const { document } = parseHTML(await read(`${lesson.slug}.html`));
    const code = lesson.sections.filter(s => s.code).map(s => s.code);
    assert.deepEqual([...document.querySelectorAll(".dl-code pre code")].map(n=>n.textContent), code);
    assert.equal(document.querySelectorAll(".dl-task details").length, 2);
    assert.equal(document.querySelectorAll("h1").length, 1);
    assert.ok(document.querySelector('a[href="deep-learning-study.html"]'));
    assert.equal(document.querySelectorAll(".lesson-pagination a").length, 2);
    assert.match(document.querySelector(".dl-runtime").textContent, lesson.runtime === "pytorch" ? /not the standard Room310 compiler/ : /ordinary Python/);
    if (lesson.runtime === "pytorch") {
      assert.equal(document.body.dataset.runtime, "external-pytorch");
      assert.equal(document.querySelectorAll('script[src^="python-lab.js"]').length, 0);
      assert.equal(document.querySelectorAll("[data-static-example]").length, code.length);
      assert.equal(document.querySelectorAll(".dl-copy").length, code.length);
    } else {
      assert.equal(document.body.dataset.runtime, undefined);
      assert.ok(document.querySelector('script[src^="python-lab.js"]'));
      assert.deepEqual([...document.querySelectorAll("[data-python-source]")].map(p=>p.dataset.pythonSource), code);
    }
    for (const link of document.querySelectorAll("a[href]")) {
      const href = link.getAttribute("href");
      if (href.startsWith("https://")) {
        if (href.includes("colab.research.google.com")) assert.ok(href.endsWith(`/${lesson.slug}.ipynb`));
        continue;
      }
      if (href.startsWith("/")) continue;
      const [file, fragment] = href.split("#");
      if (file) await access(new URL(file, base));
      if (!file && fragment) assert.ok(document.getElementById(fragment), `missing anchor ${fragment}`);
    }
    const notebook = JSON.parse(await read(`notebooks/${lesson.slug}.ipynb`));
    assert.equal(notebook.nbformat, 4);
    const notebookCode = notebook.cells.filter(c => c.cell_type === "code").slice(0, code.length);
    assert.deepEqual(notebookCode.map(c=>c.source.join("")), code);
    for (const cell of notebookCode) {
      assert.equal(typeof cell.execution_count, "number", "notebook should be executed before release");
      assert.ok(!cell.outputs.some(output=>output.output_type === "error"));
    }
    const markdown = notebook.cells.filter(c=>c.cell_type === "markdown").map(c=>c.source.join("")).join("\n");
    for (const heading of ["## Goal", "## Setup", "## Steps", "## Checks", "## Next Steps"]) assert.ok(markdown.includes(heading));
    const script = await read(`downloads/${lesson.slug}.py`);
    for (const source of code) assert.ok(script.includes(source));
    assert.match(document.querySelector(".lesson-hero").textContent, new RegExp(`Lesson 0${index+1} of 06`));
  });
}

test("external PyTorch pages cannot accidentally start an unsupported assignment runner", async () => {
  const { document } = parseHTML('<html><body class="curriculum-page" data-runtime="external-pytorch"></body></html>');
  vm.runInNewContext(await read("assignment-workspace.js"), { document });
  assert.equal(document.querySelectorAll("textarea, button").length, 0);
  const polish = await read("site-polish.js");
  assert.match(polish, /needsAssignmentWorkspace = isCurriculum && document\.body\.dataset\.runtime !== "external-pytorch"/);
  assert.match(polish, /if \(isCurriculum\) \{/); // Coloring still loads on external-runtime pages.
});

test("copy controls preserve exact Python source", async () => {
  const { document } = parseHTML(await read(`${lessons[2].slug}.html`));
  const copied = [];
  vm.runInNewContext(await read("deep-learning.js"), {document, location:{hostname:"projectroom310.com"}, navigator:{clipboard:{writeText:async text=>copied.push(text)}}, setTimeout:()=>0});
  const button = document.querySelector(".dl-copy");
  assert.equal(button.hidden, false);
  button.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(copied[0], lessons[2].sections[0].code);
  assert.equal(button.textContent, "Copied!");
  assert.doesNotMatch(await read("deep-learning.js"), /fetch\(|\/api\/run/);
});

test("copy falls back to selecting source when clipboard permission is unavailable", async () => {
  const { document } = parseHTML(await read(`${lessons[2].slug}.html`));
  let selected = "";
  let focused = false;
  const range = {selectNodeContents:node=>{selected=node.textContent;}};
  document.createRange = () => range;
  document.querySelector(".dl-code pre").focus = () => {focused = true;};
  vm.runInNewContext(await read("deep-learning.js"), {
    document, location:{hostname:"projectroom310.com"},
    navigator:{clipboard:{writeText:async()=>{throw new Error("Permission denied");}}},
    window:{getSelection:()=>({removeAllRanges(){},addRange(){}})}, setTimeout:()=>0
  });
  document.querySelector(".dl-copy").click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(selected, lessons[2].sections[0].code);
  assert.equal(focused, true);
  assert.match(document.querySelector(".dl-copy").textContent, /Selected/);
});

test("localhost notebooks use an upload guide to preserve unpublished local edits", async () => {
  const { document } = parseHTML(await read(`${lessons[2].slug}.html`));
  vm.runInNewContext(await read("deep-learning.js"), {document, location:{hostname:"127.0.0.1"}});
  assert.equal(document.querySelector(".dl-preview-note").hidden, false);
  assert.equal(document.querySelector("[data-colab-link]").getAttribute("href"), "https://colab.research.google.com/");
  assert.match(document.querySelector("[data-colab-link]").textContent, /upload notebook/);
});

test("capstone explicitly separates evaluation and saves a trusted inference checkpoint", async () => {
  const script = await read(`downloads/${lessons[5].slug}.py`);
  assert.match(script, /order\[:240\], order\[240:320\], order\[320:\]/);
  assert.match(script, /loss_fn\(model\(X_train\), y_train\)/);
  assert.match(script, /weights_only=True/);
  assert.match(script, /torch\.allclose\(model\(X_test\), restored\(X_test\)\)/);
});
