import test from "node:test";
import assert from "node:assert/strict";
import handler, { importGraph, metadataFromHtml } from "../netlify/functions/graph-import.mjs";

const source = "https://www.desmos.com/calculator/fmxds1uvhe";
const image = "https://www.desmos.com/calc_thumbs/production/fmxds1uvhe.png";
const html = `<meta property="og:title" content="Sliders &amp; parabolas"><meta content='${image}' property='og:image'>`;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=", "base64");

test("graph metadata supports attribute order and escaped titles", () => {
  assert.deepEqual(metadataFromHtml(html), { title: "Sliders & parabolas", imageUrl: image });
});

test("metadata cannot turn graph importing into a general URL fetcher", () => {
  for (const url of ["http://127.0.0.1/secret.png", "https://evil.test/cover.png", "https://www.desmos.com/api/secret.png", `${image}?redirect=1`]) assert.throws(() => metadataFromHtml(`<meta property="og:image" content="${url}">`));
  assert.throws(() => metadataFromHtml("<!doctype html><h1>Not found</h1>"), /unavailable/);
});

test("import downloads the actual PNG and disables redirects", async () => {
  const calls = [];
  const result = await importGraph(source, async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, "error");
    assert.ok(options.signal);
    return url === source ? new Response(html) : new Response(png, { headers: { "content-type": "image/png" } });
  });
  assert.deepEqual(calls, [source, image]);
  assert.equal(result.url, source);
  assert.equal(result.thumbnail, `data:image/png;base64,${png.toString("base64")}`);
});

test("invalid and oversized upstream images fail with useful messages", async () => {
  for (const response of [new Response("<!doctype html>", { headers: { "content-type": "text/html" } }), new Response("fake png", { headers: { "content-type": "image/png" } }), new Response(png, { headers: { "content-type": "image/png", "content-length": String(6 * 1024 * 1024) } })]) {
    await assert.rejects(importGraph(source, async url => url === source ? new Response(html) : response), /preview|valid graph image/);
  }
  await assert.rejects(importGraph(source, async () => new Response("", { status: 404 })), /could not open/);
});

test("import endpoint returns JSON for unsupported methods and unauthenticated users", async () => {
  for (const [method, status] of [["GET", 405], ["POST", 401]]) {
    const response = await handler(new Request("https://room310.test/api/graphs/import", { method }));
    assert.equal(response.status, status);
    assert.match(response.headers.get("content-type"), /application\/json/);
    assert.ok((await response.json()).error);
  }
});

test("import endpoint verifies the user and manager approval before fetching Desmos", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  process.env.SUPABASE_URL = "https://room310-auth-test.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "test-key";
  let approved = false;
  let validUser = true;
  let desmosRequests = 0;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) return Response.json(validUser ? { id: "00000000-0000-4000-8000-000000000008" } : { message: "Invalid token" }, { status: validUser ? 200 : 401 });
    if (url.includes("/rest/v1/profiles")) return Response.json({ role: "editor", approved });
    desmosRequests++;
    return url === source ? new Response(html) : new Response(png, { headers: { "content-type": "image/png" } });
  };
  const request = (body = JSON.stringify({ source })) => new Request("https://room310.test/api/graphs/import", { method: "POST", headers: { authorization: "Bearer test-token" }, body });
  try {
    assert.equal((await handler(request())).status, 403);
    assert.equal(desmosRequests, 0);
    validUser = false;
    assert.equal((await handler(request())).status, 401);
    assert.equal(desmosRequests, 0);
    validUser = true;
    approved = true;
    assert.equal((await handler(request("not json"))).status, 400);
    assert.equal((await handler(request("x".repeat(5001)))).status, 413);
    const response = await handler(request());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).url, source);
    assert.equal(desmosRequests, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = originalKey;
  }
});
