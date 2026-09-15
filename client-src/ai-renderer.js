import DOMPurify from "dompurify";
import katex from "katex";
import { marked } from "marked";

const mathExtension = (name, level, pattern, displayMode) => ({
  name,
  level,
  start(source) {
    const starts = displayMode
      ? [source.indexOf("$$"), source.indexOf("\\[")]
      : [source.indexOf("\\(")];
    return starts.filter((index) => index >= 0).sort((a, b) => a - b)[0];
  },
  tokenizer(source) {
    const match = pattern.exec(source);
    if (!match) return undefined;
    return { type: name, raw: match[0], text: (match[1] || match[2]).trim() };
  },
  renderer(token) {
    try {
      return katex.renderToString(token.text, { displayMode, throwOnError: false, strict: "ignore" });
    } catch {
      return `<code>${token.text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</code>`;
    }
  }
});

marked.use({
  breaks: true,
  gfm: true,
  extensions: [
    mathExtension("room310BlockMath", "block", /^(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])(?:\n+|$)/, true),
    mathExtension("room310InlineMath", "inline", /^\\\(([^\n]+?)\\\)/, false)
  ]
});

export function markdown(text) {
  return DOMPurify.sanitize(marked.parse(text), {
    USE_PROFILES: { html: true, mathMl: true }
  });
}

export function decorateMarkdown(container) {
  container.querySelectorAll("a[href]").forEach((link) => {
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
  });
}
