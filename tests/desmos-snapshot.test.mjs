import test from "node:test";
import assert from "node:assert/strict";
import handler, { config, createDesmosState, saveDesmosSnapshot, validateSnapshotPayload } from "../netlify/functions/desmos-snapshot.mjs";

const env = {
  SUPABASE_URL: "https://room310-desmos-test.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "test-publishable-key"
};
const thumbnailData = `data:image/png;base64,${Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]).toString("base64")}`;
const payload = {
  expressions: [{ latex: "y=x^2-4", color: "#C74440" }, { latex: "x=2", hidden: true }],
  bounds: { left: -5, right: 5, bottom: -6, top: 10 },
  thumbnailData
};

function request(body = payload, token = "test-admin-session") {
  return new Request("https://room310.test/api/desmos/snapshot", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}`, "content-type": "application/json" } : { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

function dependencies({ user = true, approved = true, role = "admin", upstreamOk = true } = {}) {
  const seen = { token: null, profileId: null, upstream: null };
  const createSupabaseClient = () => ({
    auth: {
      async getUser(token) {
        seen.token = token;
        return user
          ? { data: { user: { id: "00000000-0000-4000-8000-000000000310" } }, error: null }
          : { data: { user: null }, error: new Error("expired") };
      }
    },
    from(table) {
      assert.equal(table, "profiles");
      return {
        select(columns) {
          assert.equal(columns, "role,approved");
          return {
            eq(column, id) {
              assert.equal(column, "id");
              seen.profileId = id;
              return { async single() { return { data: { approved, role }, error: null }; } };
            }
          };
        }
      };
    }
  });
  const fetcher = async (url, options) => {
    seen.upstream = { url, options };
    return new Response(upstreamOk ? "{}" : "unavailable", { status: upstreamOk ? 200 : 503 });
  };
  return { seen, options: { env, createSupabaseClient, fetcher, hash: "room310abc", stateSeed: "fixed-seed" } };
}

test("snapshot validation accepts only bounded equations and a real PNG data URI", () => {
  const valid = validateSnapshotPayload(payload);
  assert.deepEqual(valid.expressions, [
    { latex: "y=x^2-4", color: "#c74440" },
    { latex: "x=2", hidden: true }
  ]);
  assert.throws(() => validateSnapshotPayload({ ...payload, expressions: [{ latex: "x\n<script>" }] }));
  assert.throws(() => validateSnapshotPayload({ ...payload, bounds: { left: 5, right: -5, bottom: -1, top: 1 } }));
  assert.throws(() => validateSnapshotPayload({ ...payload, thumbnailData: "data:image/png;base64,AAAA" }));
});

test("Desmos state contains only validated calculator fields", () => {
  const valid = validateSnapshotPayload(payload);
  const state = createDesmosState(valid, "fixed-seed");
  assert.equal(state.version, 11);
  assert.deepEqual(state.graph.viewport, { xmin: -5, ymin: -6, xmax: 5, ymax: 10 });
  assert.deepEqual(state.expressions.list[0], { type: "expression", id: "1", color: "#c74440", latex: "y=x^2-4" });
  assert.equal(state.expressions.list[1].hidden, true);
  assert.equal(JSON.stringify(state).includes("thumbnailData"), false);
});

test("approved Graphs administrators can create the experimental Desmos snapshot", async () => {
  const mock = dependencies();
  const response = await handler(request(), mock.options);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { url: "https://www.desmos.com/calculator/room310abc", experimental: true });
  assert.equal(mock.seen.token, "test-admin-session");
  assert.equal(mock.seen.upstream.url, "https://www.desmos.com/api/v1/calculator-shared/save");
  const upstream = JSON.parse(mock.seen.upstream.options.body);
  assert.equal(upstream.hash, "room310abc");
  assert.equal(upstream.type, "quick-link");
  assert.equal(upstream.product, "graphing");
  assert.equal(JSON.parse(upstream.state).expressions.list[0].latex, "y=x^2-4");
  assert.equal(mock.seen.upstream.options.headers.authorization, undefined);
  assert.equal(mock.seen.upstream.options.body.includes("test-admin-session"), false);
});

test("anonymous, expired, unapproved, and non-manager accounts cannot create snapshots", async () => {
  assert.equal((await handler(request(payload, ""), dependencies().options)).status, 401);
  assert.equal((await handler(request(), dependencies({ user: false }).options)).status, 401);
  const unapproved = dependencies({ approved: false });
  assert.equal((await handler(request(), unapproved.options)).status, 403);
  assert.equal(unapproved.seen.upstream, null);
  const student = dependencies({ role: "student" });
  assert.equal((await handler(request(), student.options)).status, 403);
  assert.equal(student.seen.upstream, null);
});

test("upstream failures are reported without inventing a working Desmos URL", async () => {
  const mock = dependencies({ upstreamOk: false });
  const response = await handler(request(), mock.options);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /experimental feature/);
});

test("snapshot endpoint has a narrow rate limit and rejects invalid methods", async () => {
  assert.deepEqual(config.rateLimit, { windowLimit: 12, windowSize: 300, aggregateBy: ["ip", "domain"] });
  const response = await handler(new Request("https://room310.test/api/desmos/snapshot", { method: "GET" }), dependencies().options);
  assert.equal(response.status, 405);
});

test("save request uses a fixed Desmos endpoint and no redirects", async () => {
  const valid = validateSnapshotPayload(payload);
  let options;
  const result = await saveDesmosSnapshot(valid, {
    hash: "abcdefgh12",
    stateSeed: "seed",
    fetcher: async (_url, value) => { options = value; return new Response("{}", { status: 200 }); }
  });
  assert.equal(result.url, "https://www.desmos.com/calculator/abcdefgh12");
  assert.equal(options.redirect, "error");
});
