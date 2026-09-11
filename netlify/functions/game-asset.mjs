import { createClient } from "@supabase/supabase-js";
import { unzipSync } from "fflate";

const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 80 * 1024 * 1024;
const MAX_FILES = 1000;
const ALLOWED_EXTENSIONS = new Set([
  ".html", ".htm", ".js", ".mjs", ".css", ".json", ".map", ".wasm",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico",
  ".mp3", ".wav", ".ogg", ".m4a", ".mp4", ".webm",
  ".ttf", ".otf", ".woff", ".woff2", ".txt", ".xml", ".csv",
  ".gltf", ".glb", ".bin"
]);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8", ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8", ".wasm": "application/wasm",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4",
  ".mp4": "video/mp4", ".webm": "video/webm", ".ttf": "font/ttf", ".otf": "font/otf",
  ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8", ".csv": "text/csv; charset=utf-8",
  ".gltf": "model/gltf+json", ".glb": "model/gltf-binary", ".bin": "application/octet-stream"
};

const HTML_CSP = [
  "sandbox allow-scripts allow-pointer-lock",
  "default-src http: https: data: blob:",
  "script-src http: https: data: blob: 'unsafe-inline' 'unsafe-eval'",
  "style-src http: https: data: blob: 'unsafe-inline'",
  "connect-src http: https: ws: wss:",
  "img-src http: https: data: blob:",
  "media-src http: https: data: blob:",
  "font-src http: https: data: blob:",
  "worker-src blob:",
  "frame-src http: https: data: blob:",
  "frame-ancestors 'self' https://projectroom310.com https://www.projectroom310.com",
  "form-action 'none'"
].join("; ");

function extension(path) {
  const match = path.toLowerCase().match(/(\.[a-z0-9]+)$/);
  return match?.[1] || "";
}

function safeEntryName(name) {
  if (!name || name.length > 700 || name.startsWith("/") || name.includes("\\") || name.includes("\0")) return false;
  const directory = name.endsWith("/");
  const parts = name.slice(0, directory ? -1 : undefined).split("/");
  if (!parts.length || parts.some((part) => !part || part === "." || part === ".." || part.length > 255 || part.includes(":") || /[\x00-\x1f]/.test(part))) return false;
  return directory || ALLOWED_EXTENSIONS.has(extension(name));
}

export function inspectArchive(data) {
  if (!(data instanceof Uint8Array) || !data.length || data.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error("Hosted game ZIP must be between 1 byte and 20 MB.");
  }
  const files = [];
  const names = new Set();
  let expandedBytes = 0;
  unzipSync(data, {
    filter(file) {
      if (!safeEntryName(file.name) || ![0, 8].includes(file.compression)) {
        throw new Error("Hosted game ZIP contains an unsafe or unsupported file.");
      }
      if (!file.name.endsWith("/")) {
        files.push(file);
        expandedBytes += file.originalSize;
        const folded = file.name.toLowerCase();
        if (names.has(folded)) throw new Error("Hosted game ZIP contains duplicate filenames.");
        names.add(folded);
      }
      if (files.length > MAX_FILES) throw new Error(`Hosted game ZIP must contain 1-${MAX_FILES} files.`);
      if (expandedBytes > MAX_EXPANDED_BYTES) throw new Error("Hosted game expands beyond the 80 MB safety limit.");
      return false;
    }
  });
  if (!files.length) throw new Error("Hosted game ZIP contains no files.");

  let prefix = "";
  if (!names.has("index.html")) {
    const roots = new Set(files.map((file) => file.name.split("/")[0]));
    if (roots.size !== 1) throw new Error("Hosted game ZIP needs an index.html file at its top level.");
    prefix = `${[...roots][0]}/`;
    if (!names.has(`${prefix}index.html`.toLowerCase()) || files.some((file) => !file.name.startsWith(prefix))) {
      throw new Error("Hosted game ZIP needs an index.html file at its top level.");
    }
  }
  return { files, names, prefix };
}

function safeRequestedPath(value) {
  const raw = String(value || "");
  if (raw.length > 700 || raw.includes("\\") || raw.includes("\0") || raw.startsWith("/")) throw new Error("Game asset not found.");
  const withIndex = !raw || raw.endsWith("/") ? `${raw}index.html` : raw;
  const parts = withIndex.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.length > 255 || part.includes(":") || /[\x00-\x1f]/.test(part))) {
    throw new Error("Game asset not found.");
  }
  return withIndex;
}

export function routeFromUrl(input) {
  const url = new URL(input);
  let routed = url.searchParams.get("asset");
  if (routed === null) {
    const match = url.pathname.match(/^\/game-assets\/([^/]+)(?:\/(.*))?$/);
    if (!match) throw new Error("Game asset not found.");
    routed = `${match[1]}/${match[2] || ""}`;
    try { routed = decodeURIComponent(routed); } catch { throw new Error("Game asset not found."); }
  }
  const slash = routed.indexOf("/");
  const slug = slash < 0 ? routed : routed.slice(0, slash);
  const path = slash < 0 ? "" : routed.slice(slash + 1);
  if (!/^[a-z0-9][a-z0-9-]{0,69}$/.test(slug)) throw new Error("Game asset not found.");
  return { slug, path: safeRequestedPath(path) };
}

export function extractAsset(data, requestedPath) {
  const archive = inspectArchive(data);
  let archiveName = `${archive.prefix}${requestedPath}`;
  if (!archive.names.has(archiveName.toLowerCase())) {
    const directoryIndex = `${archive.prefix}${requestedPath}/index.html`;
    if (!archive.names.has(directoryIndex.toLowerCase())) throw new Error("Game asset not found.");
    archiveName = directoryIndex;
  }
  const actualName = archive.files.find((file) => file.name.toLowerCase() === archiveName.toLowerCase()).name;
  const extracted = unzipSync(data, { filter: (file) => file.name === actualName })[actualName];
  if (!extracted) throw new Error("Game asset not found.");
  return { body: extracted, path: actualName, contentType: MIME_TYPES[extension(actualName)] || "application/octet-stream" };
}

function publicClient() {
  const projectUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!projectUrl || !publishableKey) throw new Error("Hosted games are not configured yet.");
  return createClient(projectUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

async function downloadPublishedBundle(client, slug) {
  const { data: game, error } = await client
    .from("games")
    .select("bundle_path")
    .eq("slug", slug)
    .eq("status", "published")
    .eq("host_type", "hosted")
    .single();
  if (error || !game?.bundle_path) throw new Error("Game asset not found.");
  const { data, error: downloadError } = await client.storage.from("game-bundles").download(game.bundle_path, {}, { cache: "no-store" });
  if (downloadError || !data) throw new Error("Game asset not found.");
  const bytes = new Uint8Array(await data.arrayBuffer());
  return { bytes, bundlePath: game.bundle_path };
}

function errorResponse(error, status = 404) {
  const configured = error.message === "Hosted games are not configured yet.";
  return new Response(configured ? error.message : "Game asset not found.", {
    status: configured ? 503 : status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "sandbox; default-src 'none'; frame-ancestors 'self' https://projectroom310.com https://www.projectroom310.com",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "access-control-allow-origin": "*"
    }
  });
}

export async function serveGameAsset(request, client = null) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, HEAD, OPTIONS" } });
  if (!['GET', 'HEAD'].includes(request.method)) return errorResponse(new Error("Method not allowed."), 405);
  try {
    const { slug, path } = routeFromUrl(request.url);
    const { bytes, bundlePath } = await downloadPublishedBundle(client || publicClient(), slug);
    const asset = extractAsset(bytes, path);
    const etag = `"${Buffer.from(`${bundlePath}\0${asset.path}\0${asset.body.length}`).toString("base64url")}"`;
    const headers = new Headers({
      "content-type": asset.contentType,
      "content-length": String(asset.body.length),
      "cache-control": "public, max-age=60, must-revalidate",
      "netlify-cdn-cache-control": "public, durable, max-age=60, stale-while-revalidate=300",
      "etag": etag,
      "accept-ranges": "bytes",
      "access-control-allow-origin": "*",
      "cross-origin-resource-policy": "cross-origin",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff"
    });
    if (asset.contentType.startsWith("text/html")) headers.set("content-security-policy", HTML_CSP);
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });

    let body = asset.body;
    let status = 200;
    const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
    if (range) {
      const start = range[1] ? Number(range[1]) : Math.max(0, body.length - Number(range[2] || 0));
      const end = range[1] ? Math.min(body.length - 1, Number(range[2] || body.length - 1)) : body.length - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= body.length) {
        headers.set("content-range", `bytes */${body.length}`);
        headers.delete("content-length");
        return new Response(null, { status: 416, headers });
      }
      headers.set("content-range", `bytes ${start}-${end}/${body.length}`);
      body = body.subarray(start, end + 1);
      headers.set("content-length", String(body.length));
      status = 206;
    }
    return new Response(request.method === "HEAD" ? null : body, { status, headers });
  } catch (error) {
    return errorResponse(error);
  }
}

export default serveGameAsset;
