export function parseDesmosGraph(value) {
  let source = String(value || "").trim();
  if (source.length > 4096) throw new Error("Paste just the Desmos share link or embed code.");
  if (/^<iframe\b/i.test(source)) {
    const match = source.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if (!match) throw new Error("That embed code has no graph link.");
    source = match[1].replace(/&amp;/g, "&");
  }
  if (/^(?:www\.)?desmos\.com\//i.test(source)) source = `https://${source}`;
  let url;
  try { url = new URL(source); } catch { throw new Error("Paste a saved Desmos graph link, such as https://www.desmos.com/calculator/abcdefghij."); }
  const match = url.pathname.match(/^\/calculator\/([a-zA-Z0-9_-]{6,80})\/?$/);
  if (url.protocol !== "https:" || !["desmos.com", "www.desmos.com"].includes(url.hostname) || url.port || url.username || url.password || !match) {
    throw new Error("Use a saved graph from the Desmos Graphing Calculator. Click Share in Desmos to get its link.");
  }
  const canonical = `https://www.desmos.com/calculator/${match[1]}`;
  // Use the saved calculator inside the iframe. Desmos's ?embed view hides equations
  // and sliders; the regular calculator keeps those beginner controls available.
  return { id: match[1], url: canonical, embedUrl: canonical };
}

export function graphPageUrl(slug) {
  return `/graphs/${encodeURIComponent(slug)}`;
}

export function safeLoginDestination(search) {
  return new URLSearchParams(search).get("next") === "/admin/graphs" ? "/admin/graphs" : "/admin/games";
}
