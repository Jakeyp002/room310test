import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseHTML } from "linkedom";
import { highlightCode, structuralCode } from "../client-src/syntax-utils.js";
import { installCodeTools } from "../client-src/code-tools.js";
import { formatPanel, normalizeProgram, normalizeOutput } from "../scripts/format-assignments.mjs";
import { box, initials } from "../scripts/assignment-layout-repairs.mjs";
import vm from "node:vm";

const examples = {
  python: '# note\ndef greet(name):\n    return "Hi " + name + str(42)',
  java: '// note\npublic class Main { int n = 42; String name = "Ada"; }',
  cpp: '// note\nint main() { std::cout << "Hello"; return 42; }',
  javascript: '// note\nconst greet = (name) => `Hello ${name}`; console.log(42);',
  csharp: '// note\nstring name = "Ada"; Console.WriteLine(42);',
  sql: "-- note\nSELECT 'Ada', 42 FROM students;"
};
for (const [language, source] of Object.entries(examples)) {
  test(`${language} gets syntax tokens without changing the source`, () => {
    const html = highlightCode(source, language);
    for (const type of ["comment", "keyword", "string", "number"]) assert.match(html, new RegExp(`class="token [^"]*${type}`));
    const { document } = parseHTML(`<pre>${html}</pre>`);
    assert.equal(document.querySelector("pre").textContent, source);
  });
}

test("strings containing HTML remain inert text, including inline snippets", () => {
  const source = 'print("<img src=x onerror=alert(1)><script>alert(2)</script>&")';
  const { document } = parseHTML(`<code>${highlightCode(source, "python")}</code>`);
  assert.equal(document.querySelectorAll("img,script").length, 0);
  assert.equal(document.querySelector("code").textContent, source);
  assert.equal(highlightCode("SELECT 1", "none"), "SELECT 1");
  assert.equal(highlightCode("<".repeat(100001), "python"), "&lt;".repeat(100001));
});

test("Java indentation tracks real braces, never those in strings or comments", () => {
  const source = 'public class Main {\n\t\tvoid hello() {\nString value = "}"; // {\n// keep this comment\n}\n}';
  const normalized = normalizeProgram(source, "java");
  assert.match(normalized, /\n    void hello\(\) \{\n        String/);
  assert.match(normalized, /\n        \/\/ keep this comment\n    }\n}/);
  assert.equal((structuralCode(source, "java").match(/{/g) || []).length, 2);
});

test("Python indentation and meaningful output spacing survive formatting", () => {
  assert.equal(normalizeProgram('def greet():\n    if True:\n        print("hi")', "python"), 'def greet():\n    if True:\n        print("hi")');
  assert.equal(normalizeOutput('\t\tName: Ada\n\tBirthday: March 30'), 'Name: Ada\nBirthday: March 30');
  assert.equal(normalizeOutput('  *\n ***\n*****'), '  *\n ***\n*****');
  assert.equal(normalizeOutput('1\t5\t19\n11\t15\t2'), '1   5   19\n11  15  2');
});

test("legacy assignment paragraphs become separately labeled code and plain output", () => {
  const html = '<div class="code-panel"><p>PROGRAM STRUCTURE:</p><p>\t\t# heading</p><p># print your name</p><p>SAMPLE RUN:</p><p>\tName: Ada</p></div>';
  const result = formatPanel(html, "python", true);
  const { document } = parseHTML(result);
  assert.equal(document.querySelector("code.language-python").textContent, '# heading\n# print your name');
  assert.equal(document.querySelector("code.language-none").textContent, 'Name: Ada');
  assert.equal(formatPanel(result, "python", true), result);
});

test("formatting does not replace an existing runnable lesson example with a static panel", () => {
  const html = '<div class="code-panel"><p>Example #1:</p><p>print(1)</p><p>OUTPUT:</p><p>1</p></div>';
  assert.equal(formatPanel(html, "python", false), html);
  const resource = '<div class="code-panel"><p>Use <a href="digits.txt">this file</a>.</p></div>';
  assert.equal(formatPanel(resource, "python", true), resource);
  const conditional = '<div class="code-panel"><p>\t\tif birthday in pi_string:</p></div>';
  assert.equal(formatPanel(conditional, "python", true), conditional);
});

test("the screenshot example and ASCII art are aligned in both language courses", async () => {
  for (const file of ["lesson-1-first-program.html", "java-1-first-program.html"]) {
    const html = await readFile(new URL(`../room310files/${file}`, import.meta.url), "utf8");
    const { document } = parseHTML(html);
    const codes = [...document.querySelectorAll(".assignment-example code")].map(node => node.textContent);
    assert.ok(codes.includes(box));
    assert.ok(codes.includes(initials));
    const heading = codes.find(code => code.includes("Program title"));
    assert.doesNotMatch(heading, /\t/);
    if (file.startsWith("lesson")) assert.ok(heading.split("\n").every(line => !line.startsWith(" ")));
  }
  assert.equal(new Set(box.split("\n").map(line => line.length)).size, 1);
});

test("the native editing layer stays accessible, source-preserving, and idempotent", () => {
  const { document, window } = parseHTML('<html><body class="curriculum-page python-page"><textarea class="python-cell-editor" aria-label="Python code"></textarea><article class="lesson-content"><div class="code-panel"><pre>print(42)</pre></div></article></body></html>');
  const editor = document.querySelector("textarea");
  editor.value = examples.python;
  const view = { MutationObserver: window.MutationObserver, ResizeObserver: class { observe() {} }, requestAnimationFrame: callback => { callback(); return 1; }, cancelAnimationFrame() {} };
  const tools = installCodeTools(document, view);
  assert.equal(editor.value, examples.python);
  assert.equal(editor.getAttribute("aria-label"), "Python code");
  assert.equal(document.querySelector(".syntax-mirror").getAttribute("aria-hidden"), "true");
  assert.equal(document.querySelector(".syntax-mirror code").textContent, examples.python + "\n");
  assert.equal(document.querySelector(".lesson-content pre code").textContent, "print(42)");
  tools.scan(document.body);
  assert.equal(document.querySelectorAll(".syntax-editor").length, 1);
  editor.value = examples.sql;
  editor.dataset.codeLanguage = "sql";
  view.Room310Code.refresh(editor);
  assert.equal(document.querySelector(".syntax-mirror code").textContent, examples.sql + "\n");
  assert.equal(editor.value, examples.sql);
  tools.observer.disconnect();
});

test("all twelve original Python and Java lessons retain their runnable cells", async () => {
  const python = [7, 15, 10, 16, 19];
  const java = [5, 9, 4, 1, 5, 8, 4];
  const files = (await import("node:fs/promises")).readdir;
  const names = await files(new URL("../room310files", import.meta.url));
  for (const [prefix, expected, runner, api] of [["lesson", python, "python-lab.js", "Room310PythonCells"], ["java", java, "course-lab.js", "Room310CourseCells"]]) {
    const script = await readFile(new URL(`../room310files/${runner}`, import.meta.url), "utf8");
    for (let i = 0; i < expected.length; i++) {
      const name = names.find(file => file.startsWith(`${prefix}-${i + 1}-`));
      const { document, window } = parseHTML(await readFile(new URL(`../room310files/${name}`, import.meta.url), "utf8"));
      vm.runInNewContext(script, { document, window, requestAnimationFrame: callback => callback() });
      assert.equal(window[api].sources().length, expected[i], name);
      assert.ok([...document.querySelectorAll(".assignment-example code")].every(code => !code.textContent.includes("\t")), name);
    }
  }
});
