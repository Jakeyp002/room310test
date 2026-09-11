export const GAME_SANDBOX = "allow-scripts allow-pointer-lock";
export const GAME_FEATURES = "fullscreen; gamepad";

export function embeddedDocument(html) {
  const source = String(html || "");
  if (/<!doctype\s+html|<html(?:\s|>)/i.test(source)) return source;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#000}body>iframe:only-child{display:block;width:100%!important;height:100%!important;border:0}</style></head><body>${source}</body></html>`;
}

export function createSandboxedGameFrame(ownerDocument, html, title = "Embedded game") {
  const frame = ownerDocument.createElement("iframe");
  frame.className = "embedded-game-frame";
  frame.title = title;
  frame.setAttribute("sandbox", GAME_SANDBOX);
  frame.setAttribute("allow", GAME_FEATURES);
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("scrolling", "no");
  frame.srcdoc = embeddedDocument(html);
  return frame;
}

export function createSandboxedUrlFrame(ownerDocument, url, title = "Game") {
  const frame = ownerDocument.createElement("iframe");
  frame.className = "embedded-game-frame";
  frame.title = title;
  frame.setAttribute("sandbox", GAME_SANDBOX);
  frame.setAttribute("allow", GAME_FEATURES);
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("scrolling", "no");
  frame.src = url;
  return frame;
}

export function renderSandboxedGame(container, html, title, onLoad) {
  const frame = createSandboxedGameFrame(container.ownerDocument, html, title);
  if (onLoad) frame.addEventListener("load", onLoad, { once: true });
  container.replaceChildren(frame);
  return frame;
}

export function renderSandboxedUrl(container, url, title, onLoad) {
  const frame = createSandboxedUrlFrame(container.ownerDocument, url, title);
  if (onLoad) frame.addEventListener("load", onLoad, { once: true });
  container.replaceChildren(frame);
  return frame;
}
