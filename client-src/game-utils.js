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
    thumbnailPath: row.thumbnail_path || "",
    bundlePath: row.bundle_path || "",
    bundleReady: Boolean(row.bundle_path),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
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
