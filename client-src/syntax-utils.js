import Prism from "prismjs";
import "prismjs/components/prism-python.js";
import "prismjs/components/prism-java.js";
import "prismjs/components/prism-c.js";
import "prismjs/components/prism-cpp.js";
import "prismjs/components/prism-csharp.js";
import "prismjs/components/prism-sql.js";

// Never let Prism rewrite lesson markup automatically or run inside a worker.
Prism.manual = true;
Prism.disableWorkerMessageHandler = true;

export const codeLanguages = ["python", "java", "cpp", "javascript", "sql", "csharp"];
export const escapeCode = value => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function highlightCode(source, language) {
  const grammar = Prism.languages[language];
  // Very large pasted files remain editable without expensive tokenization.
  if (!grammar || source.length > 100_000) return escapeCode(source);
  return Prism.highlight(source, grammar, language);
}

// Keep braces inside comments and strings out of the assignment indentation pass.
export function structuralCode(source, language) {
  const mask = tokens => tokens.map(token => {
    if (typeof token === "string") return token;
    const content = Array.isArray(token.content) ? mask(token.content) : typeof token.content === "object" ? mask([token.content]) : token.content;
    return /comment|string|char|regex/.test(token.type) ? content.replace(/[^\n]/g, " ") : content;
  }).join("");
  return mask(Prism.tokenize(source, Prism.languages[language]));
}
