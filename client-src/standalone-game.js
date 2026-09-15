import { unzipSync } from "fflate";

export const MAX_STANDALONE_BYTES = 30 * 1024 * 1024;

function safeArchiveName(name) {
  if (!name || name.length > 700 || name.startsWith("/") || name.includes("\\") || name.includes("\0")) return false;
  const directory = name.endsWith("/");
  const parts = name.slice(0, directory ? -1 : undefined).split("/");
  return parts.length > 0 && parts.every((part) => part && part !== "." && part !== ".." && part.length <= 255 && !part.includes(":") && !/[\x00-\x1f]/.test(part));
}

function decodeHtml(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    throw new Error("The game HTML must use UTF-8 text encoding.");
  }
}

function validateHtmlBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength) throw new Error("The standalone game file is empty.");
  if (bytes.byteLength > MAX_STANDALONE_BYTES) throw new Error("Standalone game HTML must be 30 MB or smaller.");
  const html = decodeHtml(bytes);
  if (!html.trim()) throw new Error("The standalone game file contains no HTML.");
  if (html.includes("\0")) throw new Error("Standalone game HTML cannot contain null characters.");
  return html;
}

export async function prepareStandaloneFile(file) {
  if (!file || typeof file.arrayBuffer !== "function") throw new Error("Choose an HTML file or a ZIP containing one HTML file.");
  if (!file.size || file.size > MAX_STANDALONE_BYTES) throw new Error("The selected file must be between 1 byte and 30 MB.");
  const sourceName = String(file.name || "game.html");
  const input = new Uint8Array(await file.arrayBuffer());
  let bytes = input;

  if (/\.zip$/i.test(sourceName) || file.type === "application/zip" || file.type === "application/x-zip-compressed") {
    let htmlEntry = null;
    let expandedBytes = 0;
    let extracted;
    try {
      extracted = unzipSync(input, {
        filter(entry) {
          if (!safeArchiveName(entry.name) || ![0, 8].includes(entry.compression)) {
            throw new Error("The ZIP contains an unsafe or unsupported entry.");
          }
          if (entry.name.endsWith("/")) return false;
          if (!/\.html?$/i.test(entry.name) || htmlEntry) {
            throw new Error("The ZIP must contain exactly one self-contained HTML file and no other files.");
          }
          expandedBytes += entry.originalSize;
          if (expandedBytes > MAX_STANDALONE_BYTES) throw new Error("The game expands beyond the 30 MB safety limit.");
          htmlEntry = entry.name;
          return true;
        }
      });
    } catch (error) {
      throw new Error(error.message || "The standalone game ZIP could not be opened.");
    }
    if (!htmlEntry || !extracted?.[htmlEntry]) throw new Error("The ZIP must contain exactly one self-contained HTML file.");
    bytes = extracted[htmlEntry];
  } else if (!/\.html?$/i.test(sourceName) && !["text/html", "application/xhtml+xml"].includes(file.type)) {
    throw new Error("Choose an .html or .htm file, or a ZIP containing one HTML file.");
  }

  const html = validateHtmlBytes(bytes);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    html,
    sha256,
    bytes: bytes.byteLength,
    uploadFile: new File([bytes], `standalone-${sha256}.html`, { type: "text/html", lastModified: file.lastModified || Date.now() }),
    sourceName
  };
}

const SCAN_RULES = [
  ["Parent-page access", /\b(?:parent|top)\s*(?:\.|\[)/i],
  ["Top-level navigation", /\b(?:top|parent)\.location\b|window\.open\s*\(/i],
  ["Service worker registration", /navigator\.serviceWorker\s*\.\s*register/i],
  ["Popup creation", /window\.open\s*\(/i],
  ["Download creation", /\bdownload\s*=|\.download\s*=/i],
  ["Cookie access", /document\.cookie/i],
  ["Browser storage access", /\b(?:localStorage|sessionStorage|indexedDB)\b/i],
  ["Remote network access", /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*(?:\(|\.)/i],
  ["Dynamic code execution", /\beval\s*\(|\bnew\s+Function\s*\(/i],
  ["External script", /<script\b[^>]*\bsrc\s*=/i],
  ["Form submission", /<form\b|\.submit\s*\(/i]
];

export function scanStandaloneHtml(html) {
  const source = String(html || "");
  return SCAN_RULES.filter(([, pattern]) => pattern.test(source)).map(([label]) => label);
}

export async function loadStandaloneHtml(client, path, { signal } = {}) {
  if (!path) throw new Error("This standalone game has no uploaded HTML file.");
  const { data, error } = await client.storage.from("game-standalone").createSignedUrl(path, 300);
  if (error || !data?.signedUrl) throw error || new Error("Room310 could not authorize this game file.");
  const response = await fetch(data.signedUrl, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal });
  if (!response.ok) throw new Error("The standalone game file could not be downloaded.");
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_STANDALONE_BYTES) throw new Error("The standalone game file is larger than the player limit.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  return validateHtmlBytes(bytes);
}
