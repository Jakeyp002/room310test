import { readFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { prepareStandaloneFile, scanStandaloneHtml } from "../client-src/standalone-game.js";
import { uploadStandaloneTus } from "../client-src/tus-upload.js";

const IMAGE_TYPES = new Map([[".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".gif", "image/gif"], [".webp", "image/webp"]]);

export function validateImportManifest(manifest) {
  if (!manifest?.collection?.title || !/^[a-z0-9][a-z0-9-]{0,69}$/.test(manifest.collection.slug || "")) throw new Error("The manifest needs a valid collection title and slug.");
  if (!manifest.permission?.sourceOwner?.trim() || !manifest.permission?.note?.trim()) throw new Error("Add the source owner and republishing permission note to the manifest before importing.");
  if (!Array.isArray(manifest.games) || !manifest.games.length) throw new Error("The manifest contains no games.");
  const slugs = new Set();
  for (const game of manifest.games) {
    if (!game.title?.trim() || !/^[a-z0-9][a-z0-9-]{0,69}$/.test(game.slug || "")) throw new Error("Every game needs a title and safe slug.");
    if (slugs.has(game.slug)) throw new Error(`Duplicate game slug: ${game.slug}`);
    slugs.add(game.slug);
    if (!game.description?.trim() || !Number.isInteger(game.year) || !game.source || !game.cover) throw new Error(`Complete the metadata for ${game.title}.`);
    if (game.sourceSha256 && !/^[a-f0-9]{64}$/.test(game.sourceSha256)) throw new Error(`${game.title} has an invalid source hash.`);
    if (game.sourceBytes != null && (!Number.isInteger(game.sourceBytes) || game.sourceBytes < 1)) throw new Error(`${game.title} has an invalid source byte size.`);
    if (game.originalSourceSha256 && !/^[a-f0-9]{64}$/.test(game.originalSourceSha256)) throw new Error(`${game.title} has an invalid original source hash.`);
    if (game.originalSourceBytes != null && (!Number.isInteger(game.originalSourceBytes) || game.originalSourceBytes < 1)) throw new Error(`${game.title} has an invalid original source byte size.`);
    if ((game.originalSourceSha256 || game.originalSourceBytes) && !game.compatibilityPreparation?.trim()) throw new Error(`${game.title} needs a compatibility preparation note.`);
  }
  return manifest;
}

export function assertPreparedMatchesManifest(game, prepared) {
  if (game.sourceBytes != null && prepared.bytes !== game.sourceBytes) throw new Error(`${game.title} does not match its recorded source byte size.`);
  if (game.sourceSha256 && prepared.sha256 !== game.sourceSha256) throw new Error(`${game.title} does not match its recorded SHA-256 hash.`);
}

async function sourceFile(path) {
  const bytes = await readFile(path);
  return new File([bytes], basename(path), { type: extname(path).toLowerCase() === ".zip" ? "application/zip" : "text/html" });
}

async function importCollection({ manifestPath, assetsDirectory, apply, publishReviewed = false, bestEffort = false }) {
  const manifest = validateImportManifest(JSON.parse(await readFile(manifestPath, "utf8")));
  const preparedGames = [];
  for (const game of manifest.games) {
    const prepared = await prepareStandaloneFile(await sourceFile(resolve(assetsDirectory, game.source)));
    assertPreparedMatchesManifest(game, prepared);
    const coverPath = resolve(assetsDirectory, game.cover);
    const coverBytes = await readFile(coverPath);
    const coverType = IMAGE_TYPES.get(extname(coverPath).toLowerCase());
    if (!coverType || !coverBytes.length || coverBytes.length > 5 * 1024 * 1024) throw new Error(`${game.title} needs a PNG, JPEG, GIF, or WebP cover no larger than 5 MB.`);
    preparedGames.push({ game, prepared, coverPath, coverBytes, coverType, findings: scanStandaloneHtml(prepared.html) });
  }

  console.log(`Validated ${preparedGames.length} standalone games for ${manifest.collection.title}.`);
  for (const item of preparedGames) {
    const findings = item.findings.length ? item.findings.join(", ") : "none";
    console.log(`- ${item.game.title}: ${item.prepared.bytes} bytes, scan findings: ${findings}, ${item.prepared.sha256}`);
  }
  if (!apply) {
    console.log("Dry run complete. Re-run with --apply after reviewing the scan output.");
    return;
  }

  const projectUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const managerAccessToken = process.env.ROOM310_MANAGER_ACCESS_TOKEN;
  const email = process.env.ROOM310_MANAGER_EMAIL;
  const password = process.env.ROOM310_MANAGER_PASSWORD;
  if (!projectUrl || !publishableKey || (!managerAccessToken && (!email || !password))) throw new Error("Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and either ROOM310_MANAGER_ACCESS_TOKEN or the manager email/password for --apply.");
  const client = createClient(projectUrl, publishableKey, {
    global: managerAccessToken ? { headers: { Authorization: `Bearer ${managerAccessToken}` } } : undefined,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  let accessToken = managerAccessToken;
  let managerUser;
  if (managerAccessToken) {
    const { data, error } = await client.auth.getUser(managerAccessToken);
    if (error || !data.user) throw error || new Error("Manager access token verification failed.");
    managerUser = data.user;
  } else {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.session) throw error || new Error("Manager sign-in failed.");
    accessToken = data.session.access_token;
    managerUser = data.user;
  }
  const { data: profile, error: profileError } = await client.from("profiles").select("role,approved").eq("id", managerUser.id).single();
  if (profileError || !profile?.approved || !["admin", "editor"].includes(profile.role)) throw new Error("The signed-in account is not an approved Room310 manager.");

  let { data: collection, error: collectionError } = await client.from("game_collections").select("id,status").eq("slug", manifest.collection.slug).maybeSingle();
  if (collectionError) throw collectionError;
  if (!collection) {
    const result = await client.from("game_collections").insert({ ...manifest.collection, status: "draft" }).select("id").single();
    if (result.error) throw result.error;
    collection = result.data;
  } else {
    const result = await client.from("game_collections").update({ title: manifest.collection.title, description: manifest.collection.description }).eq("id", collection.id);
    if (result.error) throw result.error;
  }

  const imported = [];
  const failed = [];
  for (const item of preparedGames) {
    const { game, prepared, coverBytes, coverType } = item;
    try {
      let { data: row, error: rowError } = await client.from("games").select("id,standalone_html_path,thumbnail_path").eq("slug", game.slug).maybeSingle();
      if (rowError) throw rowError;
      const draft = {
        title: game.title,
        description: game.description,
        year: game.year,
        host_type: "standalone",
        status: "draft",
        collection_id: collection.id,
        external_url: null,
        embed_html: null,
        bundle_path: null,
        standalone_reviewed_sha256: null
      };
      if (!row) {
        const result = await client.from("games").insert({ ...draft, slug: game.slug }).select("id,standalone_html_path,thumbnail_path").single();
        if (result.error) throw result.error;
        row = result.data;
      } else {
        const result = await client.from("games").update(draft).eq("id", row.id);
        if (result.error) throw result.error;
      }

      const htmlPath = `${row.id}/standalone-${prepared.sha256}.html`;
      await uploadStandaloneTus({ projectUrl, publishableKey, accessToken, file: prepared.uploadFile, objectName: htmlPath, onProgress(done, total) { process.stdout.write(`\r${game.title}: ${Math.round(done / total * 100)}%`); } });
      process.stdout.write("\n");
      const coverExtension = extname(game.cover).toLowerCase().replace(".jpeg", ".jpg");
      const coverPath = `${row.id}/cover-${prepared.sha256.slice(0, 16)}${coverExtension}`;
      const coverUpload = await client.storage.from("game-thumbnails").upload(coverPath, coverBytes, { contentType: coverType, cacheControl: "3600", upsert: true });
      if (coverUpload.error) throw coverUpload.error;
      const updated = await client.from("games").update({
        standalone_html_path: htmlPath,
        source_sha256: prepared.sha256,
        source_bytes: prepared.bytes,
        thumbnail_path: coverPath,
        standalone_reviewed_sha256: publishReviewed ? prepared.sha256 : null,
        status: publishReviewed ? "published" : "draft"
      }).eq("id", row.id);
      if (updated.error) throw updated.error;
      if (row.standalone_html_path && row.standalone_html_path !== htmlPath) await client.storage.from("game-standalone").remove([row.standalone_html_path]);
      if (row.thumbnail_path && row.thumbnail_path !== coverPath) await client.storage.from("game-thumbnails").remove([row.thumbnail_path]);
      imported.push(game.slug);
    } catch (error) {
      failed.push({ slug: game.slug, error: error.message });
      console.error(`Skipped ${game.title}: ${error.message}`);
      if (!bestEffort) throw error;
    }
  }
  if (!managerAccessToken) await client.auth.signOut();
  console.log(`Import complete: ${imported.length} imported, ${failed.length} skipped. ${publishReviewed ? "Reviewed games were published." : "Imported games remain drafts."}`);
  if (failed.length) console.log(JSON.stringify({ failed }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const publishReviewed = args.includes("--publish-reviewed");
  const bestEffort = args.includes("--best-effort");
  const values = args.filter((arg) => !["--apply", "--publish-reviewed", "--best-effort"].includes(arg));
  const manifestPath = resolve(values[0] || "game-imports/100-games-pilot.json");
  const assetsDirectory = resolve(values[1] || dirname(manifestPath));
  importCollection({ manifestPath, assetsDirectory, apply, publishReviewed, bestEffort }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
