import { readFile, readdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseHTML } from "linkedom";
import { escapeCode, structuralCode } from "../client-src/syntax-utils.js";
import { repairLayout, gameFiles } from "./assignment-layout-repairs.mjs";

const LABEL = /^(PROGRAM STRUCTURE|SAMPLE (?:RUN|OUTPUT)(?:\s*#\d+)?|DESIRED OUTPUT|OUTPUT|BASIC EXAMPLE)\s*:\s*(.*)$/i;
const typography = text => text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\u00a0/g, " ").replace(/\r/g, "");
const expandTabs = text => text.replace(/[^\n]*\t[^\n]*/g, line => {
  let result = "";
  for (const char of line) result += char === "\t" ? " ".repeat(4 - result.length % 4) : char;
  return result;
});

export function normalizeProgram(text, language) {
  const source = expandTabs(typography(text)).replace(/[ \t]+$/gm, "").trimEnd();
  const lines = source.split("\n");
  if (language === "java") {
    const structural = structuralCode(source, "java").split("\n");
    let depth = 0;
    return lines.map((line, index) => {
      const tokens = structural[index].trim();
      const closing = tokens.match(/^}+/)?.[0].length || 0;
      const indent = Math.max(0, depth - closing);
      depth = Math.max(0, depth + (tokens.match(/{/g) || []).length - (tokens.match(/}/g) || []).length);
      return line.trim() ? "    ".repeat(indent) + line.trim() : "";
    }).join("\n").trim();
  }
  const structural = structuralCode(source, "python");
  // Comment-only starter templates have no semantic indentation to retain.
  if (!structural.trim()) return lines.map(line => line.trim()).join("\n").trim();
  const nonempty = lines.filter(line => line.trim());
  const indent = Math.min(...nonempty.map(line => line.match(/^ */)[0].length));
  return lines.map(line => line.slice(indent)).join("\n").trimEnd();
}

export function normalizeOutput(text) {
  // Exported tab stops are not program output. Keep spaces in ASCII art and
  // internal tabular columns; remove only the document's leading tab padding.
  const lines = text.replace(/\u00a0/g, " ").split("\n").map(line => line.replace(/^[ \t]*\t[ \t]*/, "").trimEnd());
  const nonempty = lines.filter(line => line.trim());
  const indent = nonempty.length ? Math.min(...nonempty.map(line => line.match(/^ */)[0].length)) : 0;
  return expandTabs(lines.map(line => line.slice(indent)).join("\n")).replace(/^\n+|\n+$/g, "");
}

function panelLines(panel) {
  const clone = panel.cloneNode(true);
  clone.querySelectorAll("br").forEach(node => node.replaceWith("\n"));
  // Inline emphasis is not a new line. Only the old document paragraphs are.
  clone.querySelectorAll("p, li, tr").forEach(node => node.append("\n"));
  return clone.textContent.split("\n").map(line => line.trimEnd());
}

export function formatPanel(html, language, inAssignments = false) {
  const { document } = parseHTML(html);
  const panel = document.querySelector(".code-panel");
  if (!panel || panel.hasAttribute("data-static-example") || panel.querySelector("pre, table, img, a")) return html;
  const lines = panelLines(panel);
  const firstLine = lines.find(line => line.trim())?.trim() || "";
  if (!inAssignments && !LABEL.test(firstLine)) return html;
  // Keep existing runnable examples runnable, including those inside exercises.
  if (!lines.some(line => LABEL.test(line.trim())) && /^(?:Example.*:|(?:public |static )*(?:class |void |int |double |String )|System\.out\.|import |from |print\(|def |for |while |if |try:|with |return |@|\d|\w+\s*=|[A-Za-z_]\w*(?:\.\w+)*\s*\()/.test(firstLine)) return html;
  if (!LABEL.test(firstLine) && /^(?:From the list|If we start|This |The |Use this |To |Write )/i.test(firstLine)) return html;
  const groups = [];
  let current = { label: "Example", kind: "plain", lines: [], caption: "" };
  for (const line of lines) {
    const label = line.trim().match(LABEL);
    if (label) {
      if (current.lines.some(line => line.trim())) groups.push(current);
      current = { label: label[1].toLowerCase().replace(/^\w/, c => c.toUpperCase()), kind: /PROGRAM STRUCTURE|BASIC EXAMPLE/i.test(label[1]) ? "code" : "plain", lines: [], caption: label[2] };
    } else current.lines.push(line);
  }
  if (current.lines.some(line => line.trim())) groups.push(current);
  if (!groups.length) return html;
  return `<div class="code-panel assignment-example" data-static-example="true">${groups.map(group => {
    const normalized = group.kind === "code" ? normalizeProgram(group.lines.join("\n"), language) : normalizeOutput(group.lines.join("\n"));
    const content = repairLayout(normalized, language);
    if (group.kind === "code" && content.includes("File #1: Game1.py") && content.includes("File #3: PlayGames.py")) {
      return gameFiles.map(file => `<div class="assignment-example-label">${file.label}</div><pre><code class="language-python">${escapeCode(file.source)}</code></pre>`).join("");
    }
    return `<div class="assignment-example-label">${escapeCode(group.label)}</div>${group.caption ? `<p class="assignment-example-caption">${escapeCode(group.caption)}</p>` : ""}<pre><code class="language-${group.kind === "code" ? language : "none"}">${escapeCode(content)}</code></pre>`;
  }).join("")}</div>`;
}

export async function formatAssignments(directory, write = false) {
  const changed = [];
  for (const file of await readdir(directory)) {
    if (!/^(lesson-\d|java-\d|advanced-\d|advanced-decorators-course).*\.html$/.test(file)) continue;
    const path = `${directory}/${file}`;
    const original = await readFile(path, "utf8");
    const language = file.startsWith("java-") ? "java" : "python";
    const start = original.search(/<h[123][^>]*>(?:<a[^>]*><\/a>)?\s*(?:Chapter \d+:?\s*)?Assignments/i);
    const endOffset = start < 0 ? -1 : original.slice(start).search(/<h[12][^>]*>(?:<a[^>]*><\/a>)?Key Terms/i);
    const end = endOffset < 0 ? original.length : start + endOffset;
    let count = 0;
    const updated = original.replace(/<div class="code-panel">[\s\S]*?<\/div>/g, (panel, offset) => {
      const result = formatPanel(panel, language, start >= 0 && offset > start && offset < end);
      if (result !== panel) count++;
      return result;
    });
    if (count) {
      changed.push({ file, panels: count });
      if (write) await writeFile(path, updated);
    }
  }
  return changed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(await formatAssignments("room310files", process.argv.includes("--write")));
}
