import test from "node:test";
import assert from "node:assert/strict";
import { gameFromRow, gamePlayUrl, isApexTrailsUrl, slugify, thumbnailExtension, validateEmbedHtml } from "../client-src/game-utils.js";

test("slugify produces a safe beginner-friendly game slug", () => {
  assert.equal(slugify("  Café Racer!  "), "cafe-racer");
  assert.equal(slugify("---"), "game");
});

test("gameFromRow maps database names to the UI model", () => {
  const game = gameFromRow({
    id: 3,
    title: "Maze",
    slug: "maze",
    description: "A maze",
    year: 2026,
    status: "draft",
    host_type: "hosted",
    external_url: null,
    embed_html: null,
    thumbnail_path: null,
    bundle_path: "3/game.zip",
    created_at: "2026-09-04T00:00:00Z",
    updated_at: "2026-09-04T00:00:00Z"
  });
  assert.equal(game.hostType, "hosted");
  assert.equal(game.bundleReady, true);
});

test("embedded game rows retain their source and use the Room310 player", () => {
  const game = gameFromRow({
    id: 4,
    title: "Canvas Quest",
    slug: "canvas-quest",
    description: "A canvas game",
    year: 2026,
    status: "published",
    host_type: "embed",
    external_url: null,
    embed_html: "<canvas></canvas><script>/* game */</script>",
    thumbnail_path: null,
    bundle_path: null,
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z"
  });
  assert.match(game.embedHtml, /canvas/);
  assert.equal(gamePlayUrl(game), "/games/play/canvas-quest/");
});

test("external and hosted games open in the Room310 player", () => {
  assert.equal(gamePlayUrl({ hostType: "external", externalUrl: "https://example.com/play", slug: "example" }), "/games/play/example/");
  assert.equal(gamePlayUrl({ hostType: "hosted", slug: "zip-game" }), "/games/play/zip-game/");
});

test("standalone rows keep collection metadata and bind review to the exact hash", () => {
  const hash = "a".repeat(64);
  const game = gameFromRow({
    id: 8, title: "Standalone", slug: "standalone", description: "Stored", year: 2026, status: "published",
    host_type: "standalone", collection_id: 2, game_collections: { slug: "100-games", title: "100+ Games" },
    standalone_html_path: `8/standalone-${hash}.html`, source_sha256: hash, source_bytes: 1200,
    standalone_reviewed_sha256: hash, created_at: "2026-09-14T00:00:00Z", updated_at: "2026-09-14T00:00:00Z"
  });
  assert.equal(game.standaloneReady, true);
  assert.equal(game.collection.slug, "100-games");
  assert.equal(game.collectionId, 2);
});

test("embedded HTML validation rejects empty and oversized documents", () => {
  assert.equal(validateEmbedHtml(" <canvas></canvas> "), " <canvas></canvas> ");
  assert.throws(() => validateEmbedHtml("   "), /Paste the HTML/);
  assert.throws(() => validateEmbedHtml("x".repeat(500001)), /512 KB/);
});

test("thumbnailExtension only accepts supported image MIME types", () => {
  assert.equal(thumbnailExtension({ type: "image/png" }), "png");
  assert.equal(thumbnailExtension({ type: "image/svg+xml" }), "");
});

test("isApexTrailsUrl only accepts the HTTPS Apex Trails host", () => {
  assert.equal(isApexTrailsUrl("https://apextrails.lol/"), true);
  assert.equal(isApexTrailsUrl("https://play.apextrails.lol/level/1"), true);
  assert.equal(isApexTrailsUrl("https://oneshotstudios.org/"), true);
  assert.equal(isApexTrailsUrl("http://apextrails.lol/"), false);
  assert.equal(isApexTrailsUrl("https://apextrails.lol.example.com/"), false);
  assert.equal(isApexTrailsUrl("https://oneshotstudios.org.example.com/"), false);
  assert.equal(isApexTrailsUrl("not a URL"), false);
});
