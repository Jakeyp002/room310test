import test from "node:test";
import assert from "node:assert/strict";
import { gameFromRow, isApexTrailsUrl, slugify, thumbnailExtension } from "../client-src/game-utils.js";

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
    thumbnail_path: null,
    bundle_path: "3/game.zip",
    created_at: "2026-09-04T00:00:00Z",
    updated_at: "2026-09-04T00:00:00Z"
  });
  assert.equal(game.hostType, "hosted");
  assert.equal(game.bundleReady, true);
});

test("thumbnailExtension only accepts supported image MIME types", () => {
  assert.equal(thumbnailExtension({ type: "image/png" }), "png");
  assert.equal(thumbnailExtension({ type: "image/svg+xml" }), "");
});

test("isApexTrailsUrl only accepts the HTTPS Apex Trails host", () => {
  assert.equal(isApexTrailsUrl("https://apextrails.lol/"), true);
  assert.equal(isApexTrailsUrl("https://play.apextrails.lol/level/1"), true);
  assert.equal(isApexTrailsUrl("http://apextrails.lol/"), false);
  assert.equal(isApexTrailsUrl("https://apextrails.lol.example.com/"), false);
  assert.equal(isApexTrailsUrl("not a URL"), false);
});
