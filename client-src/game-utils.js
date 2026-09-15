export function slugify(value) {
  const base = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "game";
}

export function isApexTrailsUrl(value) {
  try {
    const url = new URL(value);
    const apexHost = url.hostname === "apextrails.lol" || url.hostname.endsWith(".apextrails.lol");
    const studioHost = url.hostname === "oneshotstudios.org" || url.hostname.endsWith(".oneshotstudios.org");
    return url.protocol === "https:" && (apexHost || studioHost);
  } catch {
    return false;
  }
}

export function gameFromRow(row) {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    year: row.year,
    status: row.status,
    hostType: row.host_type,
    externalUrl: row.external_url || "",
    embedHtml: row.embed_html || "",
    thumbnailPath: row.thumbnail_path || "",
    bundlePath: row.bundle_path || "",
    bundleReady: Boolean(row.bundle_path),
    collectionId: row.collection_id || null,
    collection: row.game_collections || row.collection || null,
    standaloneHtmlPath: row.standalone_html_path || "",
    sourceSha256: row.source_sha256 || "",
    sourceBytes: row.source_bytes || 0,
    standaloneReviewedSha256: row.standalone_reviewed_sha256 || "",
    standaloneReady: Boolean(
      row.standalone_html_path
      && row.source_sha256
      && row.source_bytes
      && row.standalone_reviewed_sha256 === row.source_sha256
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function gamePlayUrl(game) {
  return `/games/play/${encodeURIComponent(game.slug)}/`;
}

export function collectionPlayUrl(collection) {
  return `/games/collections/${encodeURIComponent(collection.slug)}/`;
}

export const MAX_EMBED_HTML_BYTES = 512 * 1024;

export function validateEmbedHtml(value) {
  const html = String(value || "");
  if (!html.trim()) throw new Error("Paste the HTML or embed code for this game.");
  if (html.length > 500_000 || new TextEncoder().encode(html).byteLength > MAX_EMBED_HTML_BYTES) {
    throw new Error("Embedded HTML must be 512 KB or smaller.");
  }
  if (html.includes("\0")) throw new Error("Embedded HTML cannot contain null characters.");
  return html;
}

export function thumbnailExtension(file) {
  const extensions = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp"
  };
  return extensions[file?.type] || "";
}
