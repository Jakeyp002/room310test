(() => {
  "use strict";

  const CONFIGS = [
    { body: "java-page", id: "java", name: "Java", short: "JAVA", color: "#ff9b63" },
    { body: "cpp-page", id: "cpp", name: "C++", short: "C++", color: "#78adff" },
    { body: "sql-page", id: "sql", name: "SQL", short: "SQL", color: "#cda4ff" },
    { body: "javascript-page", id: "javascript", name: "JavaScript", short: "JS", color: "#f7df52" },
    { body: "csharp-page", id: "csharp", name: "C#", short: "C#", color: "#b99cff" },
  ];
  const config = CONFIGS.find((item) => document.body.classList.contains(item.body));
  if (!config) return;

  document.documentElement.dataset.courseRunner = config.id;
  let activeCell = null;
  let activeRequest = null;

  const normalizeTypography = (value) => value
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, "...")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "");

  function getPanelText(panel) {
    const clone = panel.cloneNode(true);
    clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
    clone.querySelectorAll("p, li, tr, pre").forEach((block) => block.append("\n"));
    return normalizeTypography(clone.textContent);
  }

  function authoredSource(panel) {
    const example = panel.querySelector("pre");
    if (!example) return "";
    const source = normalizeTypography(example.textContent).trim();
    if (config.id === "javascript" && (/^\s*</.test(source) || /\b(?:document|window|FormData|localStorage|sessionStorage|fetch)\b|^\s*(?:import|export)\b/m.test(source))) return "";
    return source;
  }

  function javaSource(panel) {
    const fullText = getPanelText(panel);
    if (/\b(?:PROGRAM STRUCTURE|SAMPLE RUN|DESIRED OUTPUT)\s*:/i.test(fullText)) return "";
    let lines = fullText.split("\n").map((line) => line.replace(/^\s*(?:Example(?:\s*\([^)]*\))?|Code)\s*:\s*/i, ""));
    const outputIndex = lines.findIndex((line) => /^\s*(?:OUTPUT|RESULT)\s*:/i.test(line));
    if (outputIndex >= 0) lines = lines.slice(0, outputIndex);
    const codeStart = lines.findIndex((line) => /^\s*(?:import\s+|public\s+(?:final\s+)?class\s+|class\s+|System\.out\.|Scanner\s+|(?:int|double|boolean|char|String|long|float)\s+\w+\s*=|(?:if|for|while|switch)\s*\()/.test(line));
    if (codeStart < 0) return "";
    const source = lines.slice(codeStart).join("\n").replace(/\n{3,}/g, "\n\n").trim();
    return /[;{}]/.test(source) ? source : "";
  }

  function sourceFor(panel) {
    if (panel.classList.contains("authored-code-panel")) return authoredSource(panel);
    return config.id === "java" ? javaSource(panel) : "";
  }

  function needsInput(source) {
    if (config.id === "java") return /\bScanner\b|System\.in/.test(source);
    if (config.id === "cpp") return /\b(?:cin\s*>>|getline\s*\(\s*(?:std::)?cin)/.test(source);
    if (config.id === "csharp") return /Console\.ReadLine\s*\(/.test(source);
    if (config.id === "javascript") return /process\.stdin|\breadline\b/.test(source);
    return false;
  }

  function autoSize(editor) {
    editor.style.height = "auto";
    editor.style.height = `${Math.max(78, editor.scrollHeight)}px`;
  }

  function setState(cell, state, label) {
    cell.dataset.state = state;
    cell.querySelector(".python-cell-status").textContent = label;
    const busy = state === "running" || state === "compiling";
    document.querySelectorAll(".course-cell-run").forEach((button) => { button.disabled = busy; });
    cell.querySelector(".course-cell-stop").hidden = !busy;
  }

  function cleanDiagnostic(value) {
    return value
      .replace(/\/(?:private\/)?var\/folders\/.*?\/room310-cell-[^/\s:]+\//g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function finish(cell, result) {
    const outputWrap = cell.querySelector(".python-cell-output-wrap");
    const output = cell.querySelector(".python-cell-output");
    const combined = cleanDiagnostic([result.stdout, result.stderr].filter(Boolean).join(result.stdout && result.stderr ? "\n" : ""));
    const failed = result.exitCode !== 0 || result.error;
    output.textContent = combined || (failed ? (result.error || "The compiler stopped unexpectedly. Run the cell once more.") : "Done — this cell did not print anything.");
    outputWrap.hidden = false;
    setState(cell, failed ? "error" : "complete", failed ? (result.phase === "compile" ? "Fix the code" : "Check the error") : "Finished");
  }

  async function readRunnerResponse(response) {
    const text = await response.text();
    if (!text.trim()) throw new Error(`The runner returned an empty response (${response.status}). Please try again.`);
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error(`The runner returned an unreadable response (${response.status}). Please try again.`);
    }
    if (!response.ok) throw new Error(result.error || `The runner could not start (${response.status}).`);
    return result;
  }

  async function runCell(cell) {
    if (activeCell) return;
    activeCell = cell;
    activeRequest = new AbortController();
    cell.querySelector(".python-cell-output-wrap").hidden = true;
    setState(cell, "compiling", config.id === "sql" || config.id === "javascript" ? "Running…" : "Compiling…");
    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: activeRequest.signal,
        body: JSON.stringify({
          language: config.id,
          code: cell.querySelector(".python-cell-editor").value,
          input: cell.querySelector(".python-cell-input")?.value || "",
        }),
      });
      const result = await readRunnerResponse(response);
      finish(cell, result);
    } catch (error) {
      if (error.name === "AbortError") {
        finish(cell, { stdout: "Stopped. You can edit the code and run it again.", stderr: "", exitCode: 0 });
        setState(cell, "stopped", "Stopped");
      } else {
        finish(cell, { stdout: "", stderr: error.message || "The compiler service could not be reached. Please try again.", exitCode: 1 });
      }
    } finally {
      activeCell = null;
      activeRequest = null;
    }
  }

  function buildCell(source, index) {
    const original = source;
    const cell = document.createElement("section");
    cell.className = "python-cell course-code-cell";
    cell.dataset.state = "ready";
    cell.style.setProperty("--runner-accent", config.color);
    cell.setAttribute("aria-label", `Runnable ${config.name} cell ${index + 1}`);
    cell.innerHTML = `
      <div class="python-cell-bar">
        <span class="python-cell-count">${config.short} · ${String(index + 1).padStart(2, "0")}</span>
        <span class="python-cell-status" aria-live="polite">Ready</span>
        <div class="python-cell-actions">
          <button class="python-cell-reset course-cell-reset" type="button">Reset code</button>
          <button class="python-cell-stop course-cell-stop" type="button" hidden>Stop</button>
          <button class="python-cell-run course-cell-run" type="button"><span aria-hidden="true">▶</span> Run cell</button>
        </div>
      </div>
      <label class="python-cell-editor-label">
        <span class="sr-only">${config.name} code</span>
        <textarea class="python-cell-editor" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off"></textarea>
      </label>
      ${needsInput(source) ? `<label class="python-cell-input-wrap"><span>Input <small>one answer per line</small></span><textarea class="python-cell-input" rows="2" placeholder="Type the answers your program should receive…"></textarea></label>` : ""}
      <div class="python-cell-output-wrap" hidden><span>Output</span><pre class="python-cell-output" tabindex="0"></pre></div>
    `;

    const editor = cell.querySelector(".python-cell-editor");
    editor.value = source;
    editor.addEventListener("input", () => autoSize(editor));
    editor.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        runCell(cell);
      }
    });
    cell.querySelector(".course-cell-run").addEventListener("click", () => runCell(cell));
    cell.querySelector(".course-cell-stop").addEventListener("click", () => activeRequest?.abort());
    cell.querySelector(".course-cell-reset").addEventListener("click", () => {
      editor.value = original;
      autoSize(editor);
      cell.querySelector(".python-cell-output-wrap").hidden = true;
      setState(cell, "ready", "Ready");
    });
    requestAnimationFrame(() => autoSize(editor));
    return cell;
  }

  function initialize() {
    const article = document.querySelector(".lesson-content");
    if (!article) return;
    const candidates = [...article.querySelectorAll(".code-panel")]
      .map((panel) => ({ panel, source: sourceFor(panel) }))
      .filter(({ source }) => source);
    if (!candidates.length) return;

    const intro = document.createElement("aside");
    intro.className = "python-lab-note course-lab-note";
    intro.style.setProperty("--runner-accent", config.color);
    intro.innerHTML = `<div><span class="python-lab-mark" aria-hidden="true">▶</span></div><div><strong>${config.name} Lab</strong><p>Edit a cell, then press <b>Run cell</b>. Use <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd> as a shortcut. Each run starts fresh in an external sandbox, so never paste passwords or private information.</p></div>`;
    article.prepend(intro);

    const cells = candidates.map(({ panel, source }, index) => {
      const cell = buildCell(source, index);
      panel.replaceWith(cell);
      return cell;
    });
    window.Room310CourseCells = { language: config.id, count: cells.length, sources: () => cells.map((cell) => cell.querySelector(".python-cell-editor").value) };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize);
  else initialize();
})();
