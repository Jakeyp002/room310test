(() => {
  "use strict";

  document.documentElement.dataset.pythonRunner = "loaded";

  const OUTPUT_HEADING = /^\s*(?:(?:expected\s+)?(?:output|result|sample\s+(?:run|output)|desired\s+output)\s*:?.*|prints?\s*:.*)$/i;
  const SKIP_PANEL = /\b(?:PROGRAM STRUCTURE|DESIRED OUTPUT|SAMPLE RUN)\s*:/i;
  const PROSE_START = /^(?:where\b|this\b|the\b|notice\b|remember\b|types? of\b|actual math\b|in python\b|to get\b|we (?:can|could|would|use)\b)/i;

  let worker;
  let activeCell = null;
  let runSequence = 0;

  const normalizeTypography = (value) => value
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, "...")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "");

  function lineLooksLikeCode(value) {
    const line = value.trim();
    if (!line) return false;
    if (/^[A-Za-z_]\w*\([^)]*\)\s*=/.test(line)) return false;
    if (/\s+-\s+(?:where|takes?|tells?|this|allows?|returns?|the)\b/i.test(line)) return false;
    if (/^(?:@\w+|async\s+def\b.*:|def\b.*:|class\b.*:|if\b.*:|elif\b.*:|else\s*:|for\b.*:|while\b.*:|try\s*:|except\b.*:|finally\s*:|with\b.*:|from\b|import\b|return(?:\s|$)|yield(?:\s|$)|raise(?:\s|$)|assert(?:\s|$)|print\s*\()/.test(line)) return true;
    if (/^(?:pass|break|continue)\s*(?:#.*)?$/.test(line)) return true;
    if (/^[A-Za-z_]\w*(?:\[[^\]]*\])?\s*(?:=|\+=|-=|\*=|\/=)/.test(line)) return true;
    if (/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\s*\(/.test(line)) return true;
    if (/^[\]\[{}(),:'"\d.+*/%<>!=-]+$/.test(line)) return true;
    return false;
  }

  function bracketDelta(value) {
    const withoutComments = value.replace(/#.*$/, "");
    const withoutStrings = withoutComments.replace(/(["']).*?\1/g, "");
    const opens = (withoutStrings.match(/[([{]/g) || []).length;
    const closes = (withoutStrings.match(/[)\]}]/g) || []).length;
    return opens - closes;
  }

  function normalizeIndentation(lines) {
    const output = [];
    const blocks = [];
    let openBrackets = 0;

    lines.forEach(({ text, rawIndent }) => {
      const trimmed = text.trim();
      if (!trimmed) {
        if (output.length && output[output.length - 1] !== "") output.push("");
        return;
      }

      const continuation = openBrackets > 0;
      const branch = /^(?:elif\b|else\s*:|except\b|finally\s*:)/.test(trimmed);
      const returning = /^return(?:\s|$)/.test(trimmed);

      if (!continuation) {
        while (
          blocks.length &&
          blocks[blocks.length - 1].bodyRawIndent !== null &&
          rawIndent < blocks[blocks.length - 1].bodyRawIndent &&
          !(returning && blocks[blocks.length - 1].kind === "def")
        ) {
          blocks.pop();
        }
        if (branch && blocks.length) {
          while (blocks.length > 1 && rawIndent <= blocks[blocks.length - 1].rawIndent) blocks.pop();
          if (blocks.length && rawIndent <= blocks[blocks.length - 1].rawIndent) blocks.pop();
        } else {
          while (
            blocks.length &&
            blocks[blocks.length - 1].bodyRawIndent !== null &&
            rawIndent <= blocks[blocks.length - 1].rawIndent &&
            !(returning && blocks[blocks.length - 1].kind === "def")
          ) {
            blocks.pop();
          }
        }
      }

      const closingContinuation = continuation && /^[)\]}]/.test(trimmed);
      const indentLevel = blocks.length + (continuation && !closingContinuation ? 1 : 0);
      output.push(`${"    ".repeat(indentLevel)}${trimmed}`);

      if (!continuation && blocks.length && blocks[blocks.length - 1].bodyRawIndent === null) {
        blocks[blocks.length - 1].bodyRawIndent = rawIndent;
      }

      openBrackets = Math.max(0, openBrackets + bracketDelta(trimmed));
      if (!openBrackets && /:\s*(?:#.*)?$/.test(trimmed) && !/^#/.test(trimmed)) {
        blocks.push({
          rawIndent,
          bodyRawIndent: null,
          kind: /^(?:async\s+)?def\b/.test(trimmed) ? "def" : /^class\b/.test(trimmed) ? "class" : "block",
        });
      }
    });

    while (output.length && !output[output.length - 1]) output.pop();
    return output.join("\n");
  }

  function cleanSourceLines(lines) {
    const outputIndex = lines.findIndex((line) => OUTPUT_HEADING.test(line));
    if (outputIndex >= 0) lines = lines.slice(0, outputIndex);

    lines = lines
      .map((line) => line.replace(/^\s*(?:>>>|\.\.\.)\s?/, ""))
      .map((line) => line.replace(/:\s*\((?:this|described|needs|covered).*$/i, ":"))
      .map((line) => line.replace(/\s+-\s+(?:prints?|casting|where|takes?|tells?|allows?|returns?).*$/i, ""));

    const firstCodeLine = lines.findIndex(lineLooksLikeCode);
    if (firstCodeLine < 0) return "";
    if (firstCodeLine > 0) {
      let start = firstCodeLine;
      while (start > 0 && /^\s*#/.test(lines[start - 1])) start -= 1;
      lines = lines.slice(start);
    }

    let openBrackets = 0;
    let tripleQuote = false;
    const cleanedLines = [];
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        if (cleanedLines.length) cleanedLines.push({ text: "", rawIndent: 0 });
        return;
      }

      const quoteMarks = (trimmed.match(/'''|\"\"\"/g) || []).length;
      const keep = tripleQuote || openBrackets > 0 || /^\s*#/.test(line) || lineLooksLikeCode(line);
      if (keep && !PROSE_START.test(trimmed)) {
        cleanedLines.push({
          text: line,
          rawIndent: (line.match(/^\s*/) || [""])[0].replace(/\t/g, "    ").length,
        });
        openBrackets = Math.max(0, openBrackets + bracketDelta(trimmed));
      }
      if (quoteMarks % 2 === 1) tripleQuote = !tripleQuote;
    });

    while (cleanedLines.length && !cleanedLines[0].text.trim()) cleanedLines.shift();
    while (cleanedLines.length && !cleanedLines[cleanedLines.length - 1].text.trim()) cleanedLines.pop();

    const meaningful = cleanedLines.filter(({ text }) => text.trim() && !text.trim().startsWith("#"));
    if (!meaningful.length) return "";

    return normalizeIndentation(cleanedLines);
  }

  function getPanelText(panel) {
    const clone = panel.cloneNode(true);
    clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
    clone.querySelectorAll("p, li, tr, pre").forEach((block) => block.append("\n"));
    return clone.textContent;
  }

  function extractSources(panel) {
    if (panel.hasAttribute("data-static-example")) return [];
    if (panel.dataset.pythonSource) return [panel.dataset.pythonSource];
    if (SKIP_PANEL.test(panel.textContent)) return [];

    const panelText = getPanelText(panel);
    const rawLines = normalizeTypography(panelText).split("\n");
    const groups = [[]];
    const exampleLabel = /^\s*(?:example(?:s)?(?:\s*#?[\w.-]+)?|code)\s*:\s*(.*)$/i;

    rawLines.forEach((line) => {
      const match = line.match(exampleLabel);
      if (match && groups[groups.length - 1].some((item) => item.trim())) groups.push([]);
      groups[groups.length - 1].push(match ? match[1] : line);
    });

    return groups.map(cleanSourceLines).filter(Boolean);
  }

  function createWorker() {
    worker = new Worker("python-worker.mjs?v=0.4", { type: "module" });
    worker.addEventListener("message", handleWorkerMessage);
    worker.addEventListener("error", () => {
      if (activeCell) finishCell(activeCell, "Python could not start. Check your internet connection and try again.", true);
      activeCell = null;
    });
  }

  function resetWorker() {
    if (worker) worker.terminate();
    worker = null;
    activeCell = null;
  }

  function getWorker() {
    if (!worker) createWorker();
    return worker;
  }

  function autoSize(editor) {
    editor.style.height = "auto";
    editor.style.height = `${Math.max(78, editor.scrollHeight)}px`;
  }

  function setCellState(cell, state, label) {
    cell.dataset.state = state;
    const runButton = cell.querySelector(".python-cell-run");
    const stopButton = cell.querySelector(".python-cell-stop");
    const status = cell.querySelector(".python-cell-status");
    const busy = state === "loading" || state === "running";
    document.querySelectorAll(".python-cell-run").forEach((button) => {
      button.disabled = busy;
    });
    runButton.disabled = busy;
    stopButton.hidden = !busy;
    status.textContent = label;
  }

  function finishCell(cell, output, failed = false) {
    const outputWrap = cell.querySelector(".python-cell-output-wrap");
    const outputNode = cell.querySelector(".python-cell-output");
    const cleanOutput = output.replace(/^PythonError:\s*/, "").trimEnd();
    outputNode.textContent = cleanOutput || "Done — this cell did not print anything.";
    outputWrap.hidden = false;
    const hasError = failed || /(?:Traceback \(most recent call last\):|^(?:SyntaxError|Error on line|[A-Za-z]+Error)(?::| on line))/m.test(cleanOutput);
    setCellState(cell, hasError ? "error" : "complete", hasError ? "Check the error" : "Finished");
  }

  function handleWorkerMessage({ data }) {
    if (!activeCell || data.id !== activeCell.dataset.runId) return;
    if (data.type === "status") {
      setCellState(activeCell, data.status, data.status === "loading" ? "Starting Python…" : "Running…");
      return;
    }
    if (data.type === "result") {
      finishCell(activeCell, data.output);
      activeCell = null;
      return;
    }
    if (data.type === "failure") {
      const networkHint = /fetch|network|importScripts|load/i.test(data.message)
        ? "Python could not download. Check your internet connection, then try again."
        : data.message;
      finishCell(activeCell, networkHint, true);
      activeCell = null;
    }
  }

  function runCell(cell) {
    if (activeCell && activeCell !== cell) return;
    activeCell = cell;
    const id = String(++runSequence);
    cell.dataset.runId = id;
    cell.querySelector(".python-cell-output-wrap").hidden = true;
    setCellState(cell, "loading", "Starting Python…");
    getWorker().postMessage({
      type: "run",
      id,
      code: cell.querySelector(".python-cell-editor").value,
      input: cell.querySelector(".python-cell-input")?.value || "",
    });
  }

  function stopCell(cell) {
    resetWorker();
    cell.querySelector(".python-cell-output").textContent = "Stopped. Python was restarted, so values from earlier cells were cleared.";
    cell.querySelector(".python-cell-output-wrap").hidden = false;
    setCellState(cell, "stopped", "Stopped");
  }

  function buildCell(source, index) {
    const original = source;
    const needsInput = /\binput\s*\(/.test(source);
    const cell = document.createElement("section");
    cell.className = "python-cell";
    cell.dataset.state = "ready";
    cell.setAttribute("aria-label", `Runnable Python cell ${index + 1}`);
    cell.innerHTML = `
      <div class="python-cell-bar">
        <span class="python-cell-count">PY · ${String(index + 1).padStart(2, "0")}</span>
        <span class="python-cell-status" aria-live="polite">Ready</span>
        <div class="python-cell-actions">
          <button class="python-cell-reset" type="button">Reset code</button>
          <button class="python-cell-stop" type="button" hidden>Stop</button>
          <button class="python-cell-run" type="button"><span aria-hidden="true">▶</span> Run cell</button>
        </div>
      </div>
      <label class="python-cell-editor-label">
        <span class="sr-only">Python code</span>
        <textarea class="python-cell-editor" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off"></textarea>
      </label>
      ${needsInput ? `
        <label class="python-cell-input-wrap">
          <span>Input <small>one answer per line</small></span>
          <textarea class="python-cell-input" rows="2" placeholder="Type the answers your program should receive…"></textarea>
        </label>` : ""}
      <div class="python-cell-output-wrap" hidden>
        <span>Output</span>
        <pre class="python-cell-output" tabindex="0"></pre>
      </div>
    `;

    const editor = cell.querySelector(".python-cell-editor");
    editor.value = source;
    editor.dataset.codeLanguage = "python";
    editor.addEventListener("input", () => autoSize(editor));
    editor.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        runCell(cell);
      }
    });
    cell.querySelector(".python-cell-run").addEventListener("click", () => runCell(cell));
    cell.querySelector(".python-cell-stop").addEventListener("click", () => stopCell(cell));
    cell.querySelector(".python-cell-reset").addEventListener("click", () => {
      editor.value = original;
      window.Room310Code?.refresh(editor);
      autoSize(editor);
      cell.querySelector(".python-cell-output-wrap").hidden = true;
      setCellState(cell, "ready", "Ready");
    });

    requestAnimationFrame(() => autoSize(editor));
    return cell;
  }

  function initialize() {
    const article = document.querySelector(".lesson-content");
    if (!article) return;

    const candidates = [...article.querySelectorAll(".code-panel")]
      .map((panel) => ({ panel, sources: extractSources(panel) }))
      .filter(({ sources }) => sources.length);
    if (!candidates.length) return;

    const intro = document.createElement("aside");
    intro.className = "python-lab-note";
    intro.innerHTML = `
      <div><span class="python-lab-mark" aria-hidden="true">▶</span></div>
      <div>
        <strong>Python Lab</strong>
        <p>Edit a cell, then press <b>Run cell</b>. The first run may take a moment while Python starts. Use <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd> as a shortcut.</p>
      </div>
    `;
    article.prepend(intro);

    const cells = [];
    let cellIndex = 0;
    candidates.forEach(({ panel, sources }) => {
      let previousCell = null;
      sources.forEach((source) => {
        const cell = buildCell(source, cellIndex++);
        if (previousCell) previousCell.after(cell);
        else panel.replaceWith(cell);
        previousCell = cell;
        cells.push(cell);
      });
    });
    window.Room310PythonCells = {
      count: cells.length,
      sources: () => cells.map((cell) => cell.querySelector(".python-cell-editor").value),
      resetRuntime: resetWorker,
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }
})();
