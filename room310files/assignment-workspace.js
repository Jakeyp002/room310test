(() => {
  "use strict";

  if (!document.body.classList.contains("curriculum-page") || document.body.dataset.runtime === "external-pytorch" || document.documentElement.dataset.assignmentWorkspace) return;
  const siteVersion = window.ROOM310_VERSION || "0.0.0";
  document.documentElement.dataset.assignmentWorkspace = `v${siteVersion}`;

  const languages = {
    python: {
      label: "Python",
      starter: `# Write your solution here, then press Run.
name = "Room 310"
print(f"Hello from {name}!")`
    },
    java: {
      label: "Java",
      starter: `public class Main {
    public static void main(String[] args) {
        System.out.println("Hello from Room 310!");
    }
}`
    },
    cpp: {
      label: "C++",
      starter: `#include <iostream>
using namespace std;

int main() {
    cout << "Hello from Room 310!" << endl;
    return 0;
}`
    },
    javascript: {
      label: "JavaScript",
      starter: `// Write your solution here, then press Run.
const course = "Room 310";
console.log(\`Hello from \${course}!\`);`
    },
    sql: {
      label: "SQL",
      starter: `-- Try a query using the lesson's practice data.
SELECT full_name, grade_level
FROM students
ORDER BY full_name;`
    },
    csharp: {
      label: "C#",
      starter: `// Top-level C# statements are supported.
string course = "Room 310";
Console.WriteLine($"Hello from {course}!");`
    }
  };

  const defaultLanguage = document.body.classList.contains("java-page") ? "java"
    : document.body.classList.contains("cpp-page") ? "cpp"
      : document.body.classList.contains("sql-page") ? "sql"
        : document.body.classList.contains("javascript-page") ? "javascript"
          : document.body.classList.contains("csharp-page") ? "csharp"
            : "python";

  const storageKey = `room310-assignment-v0.2:${location.pathname}`;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(storageKey) || "{}"); } catch { saved = {}; }
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) saved = {};
  const drafts = Object.fromEntries(Object.entries(languages).map(([key, value]) => [key, typeof saved.drafts?.[key] === "string" ? saved.drafts[key] : value.starter]));
  let currentLanguage = Object.hasOwn(languages, saved.language) ? saved.language : defaultLanguage;
  let controller = null;
  let lastOpener = null;

  const save = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ drafts, language: currentLanguage, input: input.value }));
    } catch { /* The workspace still works if private browsing blocks storage. */ }
  };

  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "assignment-workspace-launch";
  launcher.innerHTML = `<span aria-hidden="true">&gt;_</span><span>Assignment workspace</span>`;

  const panel = document.createElement("aside");
  panel.className = "assignment-workspace-panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Assignment coding workspace");
  panel.innerHTML = `
    <header class="assignment-workspace-header">
      <div><span class="assignment-workspace-kicker">Room 310 terminal</span><strong>Assignment Workspace</strong></div>
      <div class="assignment-workspace-header-actions"><span class="assignment-workspace-version">v${siteVersion}</span><button type="button" class="assignment-workspace-close" aria-label="Close assignment workspace">×</button></div>
    </header>
    <div class="assignment-workspace-toolbar">
      <label>Language<select class="assignment-workspace-language" aria-label="Programming language"></select></label>
      <span class="assignment-workspace-status" role="status">Draft saved</span>
      <button type="button" class="assignment-workspace-reset">Reset code</button>
      <button type="button" class="assignment-workspace-run"><span aria-hidden="true">▶</span> Run</button>
    </div>
    <div class="assignment-workspace-editor-wrap">
      <div class="assignment-workspace-file"><span class="assignment-workspace-filename"></span><span>⌘/Ctrl + Enter to run</span></div>
      <textarea class="assignment-workspace-editor" spellcheck="false" aria-label="Code editor"></textarea>
    </div>
    <details class="assignment-workspace-input-wrap">
      <summary>Program input <span>Optional</span></summary>
      <label for="assignment-workspace-input">Put each answer your program reads on a new line.</label>
      <textarea id="assignment-workspace-input" class="assignment-workspace-input" rows="3" placeholder="Example:\nAda\n12"></textarea>
    </details>
    <div class="assignment-workspace-output-wrap">
      <div class="assignment-workspace-output-bar"><span>Output</span><button type="button" class="assignment-workspace-clear">Clear</button></div>
      <pre class="assignment-workspace-output" aria-live="polite">Your program's output will appear here. Runs use an external sandbox, so never paste passwords or private information.</pre>
    </div>`;

  const select = panel.querySelector(".assignment-workspace-language");
  const editor = panel.querySelector(".assignment-workspace-editor");
  const input = panel.querySelector(".assignment-workspace-input");
  const output = panel.querySelector(".assignment-workspace-output");
  const status = panel.querySelector(".assignment-workspace-status");
  const runButton = panel.querySelector(".assignment-workspace-run");
  const filename = panel.querySelector(".assignment-workspace-filename");
  const filenames = { python: "solution.py", java: "Main.java", cpp: "solution.cpp", javascript: "solution.js", sql: "query.sql", csharp: "Program.cs" };

  Object.entries(languages).forEach(([value, language]) => select.add(new Option(language.label, value)));
  select.value = currentLanguage;
  editor.value = drafts[currentLanguage];
  editor.dataset.codeLanguage = currentLanguage;
  input.value = typeof saved.input === "string" ? saved.input : "";
  filename.textContent = filenames[currentLanguage];

  const assignmentTarget = document.querySelector(".assignment-section, .chapter-project") || [...document.querySelectorAll(".lesson-content h1, .lesson-content h2, .lesson-content h3")].find((heading) => /\b(assignments?|projects?|challenge|exercises?)\b/i.test(heading.textContent));

  const cleanContextText = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const clipContext = (value, limit, keepEnd = false) => {
    const text = cleanContextText(value);
    if (text.length <= limit) return text;
    return keepEnd ? `…${text.slice(-(limit - 1))}` : `${text.slice(0, limit - 1)}…`;
  };
  const assignmentHeadingPattern = /^(?:a\s*\d+(?:\.\d+)*\b|ch(?:apter)?\.?\s*\d+\s+project\b|assignment\b|project\b|challenge\b|exercise\b)/i;

  const legacyAssignmentBlock = (heading) => {
    const level = Number(heading.tagName.slice(1));
    const nodes = [heading];
    let sibling = heading.nextElementSibling;
    while (sibling) {
      if (/^H[1-3]$/.test(sibling.tagName) && Number(sibling.tagName.slice(1)) <= level) break;
      nodes.push(sibling);
      sibling = sibling.nextElementSibling;
    }
    return nodes;
  };

  const assignmentCandidates = () => {
    const candidates = [
      ...document.querySelectorAll(".assignment-section .dl-task, .assignment-section .curriculum-assignments > li, .chapter-project")
    ];
    document.querySelectorAll(".lesson-content > h1, .lesson-content > h2, .lesson-content > h3").forEach((heading) => {
      if (assignmentHeadingPattern.test(cleanContextText(heading.textContent))) candidates.push(heading);
    });
    if (!candidates.length && assignmentTarget) candidates.push(assignmentTarget);
    return [...new Set(candidates)];
  };

  const activeAssignment = () => {
    const candidates = assignmentCandidates();
    if (!candidates.length) return null;
    const marker = Math.max(140, window.innerHeight * 0.46);
    const measured = candidates.map((element, index) => ({ element, index, rect: element.getBoundingClientRect() }));
    const nearViewport = measured.filter(({ rect }) => rect.top <= marker && rect.bottom >= 0);
    if (nearViewport.length) return nearViewport.at(-1);
    return measured.find(({ rect }) => rect.top > marker) || measured.at(-1);
  };

  const contextNodes = (element) => element.matches(".dl-task, .chapter-project, li") ? [element] : legacyAssignmentBlock(element);
  const textFromNodes = (nodes, selector, limit, keepEnd = false) => {
    const values = [];
    nodes.forEach((node) => {
      const clone = node.cloneNode(true);
      clone.querySelectorAll(".code-panel, pre, code").forEach((excluded) => excluded.remove());
      if (clone.matches(selector)) values.push(clone.textContent);
      else clone.querySelectorAll(selector).forEach((match) => {
        if (!match.parentElement?.closest(selector)) values.push(match.textContent);
      });
    });
    return clipContext(values.join("\n"), limit, keepEnd);
  };

  const assignmentTitleFor = (element) => {
    const heading = element.matches("h1, h2, h3") ? element : element.querySelector("h1, h2, h3");
    if (heading) return clipContext(heading.textContent, 220);
    const label = element.querySelector(":scope > strong")?.textContent;
    const firstInstruction = element.querySelector(":scope > p")?.textContent;
    return clipContext([label, firstInstruction].filter(Boolean).join(" · "), 220) || "Current coding assignment";
  };

  const examplesFromNodes = (nodes) => {
    const examples = [];
    const seen = new Set();
    for (const node of nodes) {
      for (const code of node.querySelectorAll("pre code, .assignment-example pre, .authored-code-panel pre")) {
        const content = String(code.textContent || "").trim();
        if (!content || seen.has(content)) continue;
        seen.add(content);
        const previousLabel = code.closest("pre")?.previousElementSibling;
        const panel = code.closest(".assignment-example, .authored-code-panel, .code-panel");
        const label = cleanContextText(
          (previousLabel?.matches(".assignment-example-label, .panel-label") ? previousLabel.textContent : "")
          || panel?.querySelector(".assignment-example-label, .panel-label")?.textContent
          || "Relevant example"
        );
        examples.push({ label: clipContext(label, 80), content: content.slice(0, 3_500) });
        if (examples.length === 6) return examples;
      }
    }
    return examples;
  };

  const lessonContextBefore = (activeElement) => {
    const lesson = document.querySelector(".lesson-content");
    if (!lesson) return "";
    const nodes = [...lesson.querySelectorAll("h1, h2, h3, p, li")].filter((node) => {
      if (node.closest(".assignment-section, .chapter-project, .code-panel, pre, code, .lesson-toc")) return false;
      return Boolean(node.compareDocumentPosition(activeElement) & 4);
    });
    return clipContext(nodes.map((node) => node.textContent).join("\n"), 6_000, true);
  };

  const getAssignmentContext = () => {
    const active = activeAssignment();
    if (!active) return null;
    const nodes = contextNodes(active.element);
    const assignmentTitle = assignmentTitleFor(active.element);
    const examples = examplesFromNodes(nodes);
    const starter = examples.find(({ label }) => /starter|program structure|starting code/i.test(label));
    const expected = examples.filter(({ label }) => /output|result|sample run|expected|behavior/i.test(label));
    const anchor = active.element.querySelector("[id]")?.id || active.element.id || "";
    const lessonTitle = cleanContextText(document.querySelector(".lesson-hero h1")?.textContent || document.title.replace(/\s*·\s*Room310.*$/, ""));
    const language = languages[currentLanguage];
    return {
      schemaVersion: 1,
      kind: "coding_assignment",
      pagePath: location.pathname,
      lessonTitle: clipContext(lessonTitle, 220),
      assignmentId: clipContext(anchor || `${location.pathname}#assignment-${active.index + 1}`, 320),
      assignmentTitle,
      instructions: textFromNodes(nodes, "h1, h2, h3, p, li", 6_000),
      lessonContext: lessonContextBefore(active.element),
      language: currentLanguage,
      languageLabel: language.label,
      starterCode: String(starter?.content || language.starter).slice(0, 10_000),
      currentCode: String(editor.value || "").slice(0, 16_000),
      currentInput: String(input.value || "").slice(0, 2_000),
      currentOutput: String(output.textContent || "").slice(0, 4_000),
      expectedBehavior: expected.map(({ label, content }) => `${label}:\n${content}`).join("\n\n").slice(0, 6_000),
      examples,
      metadata: {
        assignmentNumber: active.index + 1,
        assignmentCount: assignmentCandidates().length,
        source: active.element.matches(".dl-task, .curriculum-assignments > li, .chapter-project") ? "structured" : "legacy-heading"
      }
    };
  };
  if (assignmentTarget) {
    const inline = document.createElement("button");
    inline.type = "button";
    inline.className = "assignment-workspace-inline-launch";
    inline.innerHTML = `<span aria-hidden="true">&gt;_</span><span><strong>Do this assignment in the workspace</strong><small>Open the instructions and editor side by side</small></span><span aria-hidden="true">→</span>`;
    if (assignmentTarget.matches("section")) assignmentTarget.before(inline);
    else assignmentTarget.after(inline);
    inline.addEventListener("click", () => openWorkspace(inline, true));
  }

  const openWorkspace = (opener, keepAssignmentVisible = false) => {
    window.Room310AssignmentHelp?.close?.({ restoreFocus: false });
    lastOpener = opener || document.activeElement;
    panel.hidden = false;
    document.body.classList.add("assignment-workspace-open");
    launcher.setAttribute("aria-expanded", "true");
    panel.querySelector(".assignment-workspace-close").focus();
    window.dispatchEvent(new CustomEvent("room310:assignment-workspace-opened"));
    if (keepAssignmentVisible && assignmentTarget) requestAnimationFrame(() => assignmentTarget.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const closeWorkspace = ({ restoreFocus = true } = {}) => {
    if (controller) stopRun();
    panel.hidden = true;
    document.body.classList.remove("assignment-workspace-open");
    launcher.setAttribute("aria-expanded", "false");
    if (restoreFocus) lastOpener?.focus?.();
    window.dispatchEvent(new CustomEvent("room310:assignment-workspace-closed"));
  };

  const setRunning = (running) => {
    panel.dataset.state = running ? "running" : "idle";
    select.disabled = running;
    panel.querySelector(".assignment-workspace-reset").disabled = running;
    runButton.innerHTML = running ? `<span aria-hidden="true">■</span> Stop` : `<span aria-hidden="true">▶</span> Run`;
    if (running) status.textContent = `Running ${languages[currentLanguage].label}…`;
  };

  const stopRun = () => {
    controller?.abort();
    controller = null;
    setRunning(false);
    output.textContent = "Stopped waiting for this run. You can edit the code and run again. Remote execution may continue until its sandbox time limit.";
    status.textContent = "Stopped";
    output.parentElement.removeAttribute("data-result");
  };

  const cleanDiagnostic = (text) => text
    .replaceAll(location.origin, "")
    .replace(/\/private\/var\/folders\/[^\s:]+\/T\/room310-cell-[^\s/:]+\//g, "")
    .replace(/\/var\/folders\/[^\s:]+\/T\/room310-cell-[^\s/:]+\//g, "")
    .trim();

  const readRunnerResponse = async (response) => {
    const text = await response.text();
    if (!text.trim()) throw new Error(`The runner returned an empty response (${response.status}). Please try again.`);
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error(`The runner returned an unreadable response (${response.status}). Please try again.`);
    }
    if (!response.ok) throw new Error(result?.error || `The runner could not start (${response.status}).`);
    if (!result || !Number.isInteger(result.exitCode) || typeof result.stdout !== "string" || typeof result.stderr !== "string") throw new Error("The runner returned an incomplete result. Please try again.");
    return result;
  };

  const run = async () => {
    if (controller) return;
    drafts[currentLanguage] = editor.value;
    save();
    if (!editor.value.trim()) {
      output.textContent = "Write some code first, then press Run.";
      status.textContent = "Code needed";
      return;
    }
    const requestController = new AbortController();
    controller = requestController;
    const timer = setTimeout(() => requestController.abort(new DOMException("The run took too long. Check your connection or code, then try again.", "TimeoutError")), 45_000);
    setRunning(true);
    output.textContent = "Starting the secure runner…";
    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: currentLanguage, code: editor.value, input: input.value }),
        signal: requestController.signal
      });
      const result = await readRunnerResponse(response);
      if (controller !== requestController) return;
      const stdout = cleanDiagnostic(result.stdout || "");
      const stderr = cleanDiagnostic(result.stderr || "");
      output.textContent = stdout && stderr ? `${stdout}\n\n${result.exitCode === 0 ? "Notes" : "Error"}:\n${stderr}` : stdout || stderr || "Program finished with no output.";
      if (result.runner === "backup") output.textContent = `Backup runner: ${result.runtime || languages[currentLanguage].label}\n\n${output.textContent}`;
      status.textContent = result.exitCode === 0 ? "Finished" : result.phase === "compile" ? "Fix a compile error" : "Fix an error";
      output.parentElement.dataset.result = result.exitCode === 0 ? "success" : "error";
    } catch (error) {
      if (controller !== requestController) return;
      if (error.name !== "AbortError") {
        output.textContent = `Could not run the code. ${error.message}`;
        status.textContent = "Runner unavailable";
        output.parentElement.dataset.result = "error";
      }
    } finally {
      clearTimeout(timer);
      if (controller === requestController) {
        controller = null;
        setRunning(false);
      }
    }
  };

  select.addEventListener("change", () => {
    drafts[currentLanguage] = editor.value;
    currentLanguage = select.value;
    editor.value = drafts[currentLanguage];
    editor.dataset.codeLanguage = currentLanguage;
    window.Room310Code?.refresh(editor);
    filename.textContent = filenames[currentLanguage];
    output.textContent = `Ready to run ${languages[currentLanguage].label}.`;
    output.parentElement.removeAttribute("data-result");
    save();
    editor.focus();
  });
  editor.addEventListener("input", () => { drafts[currentLanguage] = editor.value; status.textContent = "Saving draft…"; save(); status.textContent = "Draft saved"; });
  input.addEventListener("input", save);
  editor.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); run(); }
    if (event.key === "Tab") {
      event.preventDefault();
      const start = editor.selectionStart;
      editor.setRangeText("    ", start, editor.selectionEnd, "end");
      editor.dispatchEvent(new Event("input"));
    }
  });
  launcher.addEventListener("click", () => openWorkspace(launcher));
  panel.querySelector(".assignment-workspace-close").addEventListener("click", () => closeWorkspace());
  runButton.addEventListener("click", () => controller ? stopRun() : run());
  panel.querySelector(".assignment-workspace-clear").addEventListener("click", () => { output.textContent = "Output cleared. Press Run when you are ready."; output.parentElement.removeAttribute("data-result"); });
  panel.querySelector(".assignment-workspace-reset").addEventListener("click", () => {
    drafts[currentLanguage] = languages[currentLanguage].starter;
    editor.value = drafts[currentLanguage];
    window.Room310Code?.refresh(editor);
    save();
    status.textContent = "Starter restored";
    editor.focus();
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !panel.hidden) closeWorkspace(); });

  launcher.setAttribute("aria-expanded", "false");
  launcher.setAttribute("aria-controls", "assignment-workspace");
  panel.id = "assignment-workspace";
  window.Room310AssignmentWorkspace = {
    hasAssignment: Boolean(assignmentTarget),
    isOpen: () => !panel.hidden,
    open: (opener = launcher) => openWorkspace(opener),
    close: (options) => closeWorkspace(options),
    getContext: getAssignmentContext,
    getState: () => ({ language: currentLanguage, code: editor.value, input: input.value, output: output.textContent })
  };
  document.body.append(launcher, panel);
})();
