import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { strToU8, zipSync } from "fflate";
import handler, { extractAsset, inspectArchive, routeFromUrl } from "../netlify/functions/game-asset.mjs";

const zip = (files) => zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, strToU8(value)])));

function publishedClient(archive, game = { bundle_path: "17/game-safe.zip" }) {
  const filters = [];
  const query = {
    select() { return query; },
    eq(column, value) { filters.push([column, value]); return query; },
    async single() { return { data: game, error: null }; }
  };
  return {
    filters,
    from(table) { assert.equal(table, "games"); return query; },
    storage: {
      from(bucket) {
        assert.equal(bucket, "game-bundles");
        return { async download(path) { assert.equal(path, game.bundle_path); return { data: new Blob([archive]), error: null }; } };
      }
    }
  };
}

test("hosted ZIP inspection accepts a root folder and only extracts the requested asset", () => {
  const archive = zip({
    "tiny-game/index.html": '<script src="game.js"></script>',
    "tiny-game/game.js": "document.body.dataset.ready = 'yes';",
    "tiny-game/style.css": "html,body{overflow:hidden}"
  });
  assert.equal(inspectArchive(archive).prefix, "tiny-game/");
  const asset = extractAsset(archive, "game.js");
  assert.equal(new TextDecoder().decode(asset.body), "document.body.dataset.ready = 'yes';");
  assert.equal(asset.contentType, "application/javascript; charset=utf-8");
});

test("hosted ZIP inspection rejects traversal, unsupported files, duplicates, and missing entry points", () => {
  for (const archive of [
    zip({ "index.html": "ok", "../escape.js": "bad" }),
    zip({ "index.html": "ok", "secret.exe": "bad" }),
    zip({ "INDEX.HTML": "one", "index.html": "two" }),
    zip({ "game.js": "no entry point" })
  ]) assert.throws(() => inspectArchive(archive), /unsafe|duplicate|index\.html/);
});

test("game asset routes reject encoded traversal", () => {
  assert.deepEqual(routeFromUrl("https://room310.test/game-assets/tiny-game/index.html"), { slug: "tiny-game", path: "index.html" });
  assert.throws(() => routeFromUrl("https://room310.test/.netlify/functions/game-asset?asset=tiny-game%2F..%2Fsecret"), /not found/);
  assert.throws(() => routeFromUrl("https://room310.test/game-assets/Not-Safe/index.html"), /not found/);
});

test("published hosted assets are served with an opaque-origin CSP and no secret client", async () => {
  const archive = zip({ "index.html": '<script src="game.js"></script>', "game.js": "window.started=true" });
  const client = publishedClient(archive);
  const response = await handler(new Request("https://room310.test/game-assets/tiny-game/index.html"), client);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/html/);
  assert.match(response.headers.get("content-security-policy"), /sandbox allow-scripts allow-pointer-lock/);
  assert.doesNotMatch(response.headers.get("content-security-policy"), /allow-same-origin|allow-top-navigation|allow-popups/);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(await response.text(), '<script src="game.js"></script>');
  assert.deepEqual(client.filters, [["slug", "tiny-game"], ["status", "published"], ["host_type", "hosted"]]);
});

test("hosted assets support HEAD, range requests, and unpublished-game failures", async () => {
  const archive = zip({ "index.html": "0123456789" });
  const head = await handler(new Request("https://room310.test/game-assets/tiny-game/index.html", { method: "HEAD" }), publishedClient(archive));
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "10");
  assert.equal(await head.text(), "");

  const partial = await handler(new Request("https://room310.test/game-assets/tiny-game/index.html", { headers: { range: "bytes=2-5" } }), publishedClient(archive));
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(await partial.text(), "2345");

  const missing = await handler(new Request("https://room310.test/game-assets/tiny-game/index.html"), publishedClient(archive, { bundle_path: null }));
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("cache-control"), "no-store");
});

test("the admin exposes external, embedded, standalone, and ZIP sources with upload review gates", async () => {
  const [page, admin, player, netlify] = await Promise.all([
    readFile(new URL("../room310files/admin-games.html", import.meta.url), "utf8"),
    readFile(new URL("../client-src/admin-games.js", import.meta.url), "utf8"),
    readFile(new URL("../client-src/game-player.js", import.meta.url), "utf8"),
    readFile(new URL("../netlify.toml", import.meta.url), "utf8")
  ]);
  assert.match(page, /External URL/);
  assert.match(page, /Embedded HTML/);
  assert.match(page, /Standalone HTML Game/);
  assert.match(page, /Hosted Game ZIP/);
  assert.match(page, /name="standaloneReviewed"/);
  assert.match(admin, /game\.hostType === "standalone" && !game\.standaloneReady/);
  assert.match(admin, /uploadStandaloneTus/);
  assert.match(player, /game\.hostType === "hosted"/);
  assert.match(netlify, /from = "\/game-assets\/\*"/);
  assert.match(netlify, /game-asset\?asset=:splat/);
});
