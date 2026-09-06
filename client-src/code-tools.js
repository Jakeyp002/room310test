import { codeLanguages, highlightCode } from "./syntax-utils.js";

export function installCodeTools(document, view) {
  const language = codeLanguages.find(value => document.body.classList.contains(`${value}-page`)) || "python";
  const editors = new WeakMap();
  const staticSources = new WeakMap();

  function enhanceEditor(editor) {
    if (editors.has(editor)) return editors.get(editor).refresh();
    const shell = document.createElement("div");
    shell.className = `syntax-editor${editor.classList.contains("assignment-workspace-editor") ? " syntax-workspace" : ""}`;
    const mirror = document.createElement("pre");
    mirror.className = "syntax-mirror";
    mirror.setAttribute("aria-hidden", "true");
    const code = document.createElement("code");
    mirror.append(code);
    const hadFocus = document.activeElement === editor;
    const selection = [editor.selectionStart, editor.selectionEnd];
    editor.before(shell);
    shell.append(mirror, editor);
    if (hadFocus) {
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(...selection);
    }
    editor.wrap = "off";
    editor.spellcheck = false;
    editor.setAttribute("autocapitalize", "off");
    editor.setAttribute("autocomplete", "off");
    let frame = 0;
    let previousSource;
    let previousLanguage;
    const fitCell = () => {
      if (!editor.classList.contains("python-cell-editor") || typeof editor.scrollHeight !== "number") return;
      editor.style.height = "auto";
      editor.style.height = `${Math.max(78, editor.scrollHeight)}px`;
    };
    const syncScroll = () => {
      mirror.style.width = `${editor.clientWidth}px`;
      mirror.style.height = `${editor.clientHeight}px`;
      mirror.scrollTop = editor.scrollTop;
      mirror.scrollLeft = editor.scrollLeft;
    };
    const refresh = () => {
      fitCell();
      const nextLanguage = editor.dataset.codeLanguage || language;
      if (previousSource !== editor.value || previousLanguage !== nextLanguage) {
        try {
          code.innerHTML = highlightCode(editor.value + "\n", nextLanguage);
          shell.classList.add("syntax-ready");
          previousSource = editor.value;
          previousLanguage = nextLanguage;
        } catch {
          // If coloring fails, keep the native editor visible and runnable.
          shell.classList.remove("syntax-ready");
        }
      }
      syncScroll();
    };
    const schedule = () => {
      view.cancelAnimationFrame(frame);
      frame = view.requestAnimationFrame(refresh);
    };
    editor.addEventListener("input", schedule);
    editor.addEventListener("compositionend", schedule);
    editor.addEventListener("scroll", syncScroll);
    editor.addEventListener("focus", refresh);
    const resize = new view.ResizeObserver(() => { fitCell(); syncScroll(); });
    resize.observe(editor);
    editors.set(editor, { refresh, resize });
    refresh();
  }

  function highlightExample(node) {
    if (node.closest(".syntax-editor")) return;
    const code = node.tagName === "PRE" ? node.querySelector("code") || node.appendChild(document.createElement("code")) : node;
    if (node.tagName === "PRE" && node.childNodes.length > 1 && !code.textContent) {
      const source = node.textContent;
      node.replaceChildren(code);
      code.textContent = source;
    }
    const source = code.textContent;
    const selected = code.className.match(/language-([\w-]+)/)?.[1] || node.dataset.language || language;
    if (staticSources.get(code) === `${selected}\0${source}`) return;
    staticSources.set(code, `${selected}\0${source}`);
    code.innerHTML = highlightCode(source, selected);
    code.classList.add("syntax-code");
  }

  function scan(root) {
    if (root.nodeType !== 1) return;
    if (root.matches(".python-cell-editor, .assignment-workspace-editor")) enhanceEditor(root);
    root.querySelectorAll(".python-cell-editor, .assignment-workspace-editor").forEach(enhanceEditor);
    if (root.matches(".lesson-content .code-panel pre, .lesson-content code:not(.syntax-mirror code)")) highlightExample(root);
    root.querySelectorAll(".lesson-content .code-panel pre, .lesson-content code:not(.syntax-mirror code)").forEach(highlightExample);
  }

  scan(document.body);
  const observer = new view.MutationObserver(records => {
    for (const record of records) {
      if (record.type === "attributes") editors.get(record.target)?.refresh();
      else for (const node of record.addedNodes) scan(node);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-code-language"] });
  view.Room310Code = { refresh: editor => editors.get(editor)?.refresh(), refreshAll: () => scan(document.body) };
  return { observer, scan };
}

if (typeof document !== "undefined" && document.body.classList.contains("curriculum-page")) {
  installCodeTools(document, window);
}
