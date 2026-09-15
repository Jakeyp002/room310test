import test from "node:test";
import assert from "node:assert/strict";
import { uploadStandaloneTus } from "../client-src/tus-upload.js";

test("standalone uploads use Supabase TUS with authenticated six-megabyte chunks", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    if (options.method === "POST") return new Response(null, { status: 201, headers: { location: "/storage/v1/upload/resumable/upload-1" } });
    return new Response(null, { status: 204, headers: { "upload-offset": String(options.body.size) } });
  };
  const progress = [];
  try {
    await uploadStandaloneTus({
      projectUrl: "https://abcdefgh.supabase.co",
      publishableKey: "publishable-test",
      accessToken: "manager-jwt",
      file: new File(["0123456789"], "game.html", { type: "text/html" }),
      objectName: "7/standalone-hash.html",
      onProgress(done, total) { progress.push([done, total]); }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(requests[0].url, "https://abcdefgh.storage.supabase.co/storage/v1/upload/resumable");
  assert.equal(requests[0].options.headers.authorization, "Bearer manager-jwt");
  assert.equal(requests[0].options.headers.apikey, "publishable-test");
  assert.match(requests[0].options.headers["upload-metadata"], /bucketName/);
  assert.equal(requests[1].options.method, "PATCH");
  assert.equal(requests[1].options.headers["content-type"], "application/offset+octet-stream");
  assert.deepEqual(progress, [[10, 10]]);
});
