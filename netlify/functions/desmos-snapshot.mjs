import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const DESMOS_SAVE_URL = "https://www.desmos.com/api/v1/calculator-shared/save";
const COLORS = ["#c74440", "#2d70b3", "#388c46", "#6042a6", "#fa7e19", "#000000", "#8c564b", "#d6278b"];
const MAX_BODY_CHARS = 2_200_000;
const MAX_THUMBNAIL_BYTES = 1_500_000;
const HEADERS = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff", "x-robots-tag": "noindex" };

export const config = {
  path: "/api/desmos/snapshot",
  rateLimit: { windowLimit: 12, windowSize: 300, aggregateBy: ["ip", "domain"] }
};

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: HEADERS });

export function validateSnapshotPayload(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.expressions)
    || payload.expressions.length < 1 || payload.expressions.length > 32) throw new Error("The graph has no supported expressions to share.");
  const expressions = payload.expressions.map((expression) => {
    if (!expression || typeof expression.latex !== "string") throw new Error("The graph contains an invalid expression.");
    const latex = expression.latex.trim();
    if (!latex || latex.length > 500 || /[\u0000-\u001f\u007f]/.test(latex)) throw new Error("The graph contains an invalid expression.");
    if (expression.color !== undefined && !/^#[0-9a-f]{6}$/i.test(expression.color)) throw new Error("The graph contains an invalid color.");
    if (expression.hidden !== undefined && typeof expression.hidden !== "boolean") throw new Error("The graph contains an invalid visibility setting.");
    return { latex, ...(expression.color ? { color: expression.color.toLowerCase() } : {}), ...(expression.hidden === true ? { hidden: true } : {}) };
  });
  const bounds = Object.fromEntries(["left", "right", "bottom", "top"].map((key) => [key, Number(payload.bounds?.[key])]));
  if (!Object.values(bounds).every((value) => Number.isFinite(value) && Math.abs(value) <= 1_000_000)
    || bounds.right <= bounds.left || bounds.top <= bounds.bottom) throw new Error("The graph viewport is invalid.");
  if (typeof payload.thumbnailData !== "string" || payload.thumbnailData.length > MAX_BODY_CHARS
    || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(payload.thumbnailData)) throw new Error("The graph preview is invalid.");
  const thumbnailBytes = Buffer.from(payload.thumbnailData.slice("data:image/png;base64,".length), "base64");
  if (!thumbnailBytes.length || thumbnailBytes.length > MAX_THUMBNAIL_BYTES
    || !thumbnailBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("The graph preview is invalid.");
  return { expressions, bounds, thumbnailData: payload.thumbnailData };
}

export function createDesmosState({ expressions, bounds }, randomSeed = randomBytes(16).toString("hex")) {
  return {
    version: 11,
    randomSeed,
    graph: { viewport: { xmin: bounds.left, ymin: bounds.bottom, xmax: bounds.right, ymax: bounds.top } },
    expressions: {
      list: expressions.map((expression, index) => ({
        type: "expression",
        id: String(index + 1),
        color: expression.color || COLORS[index % COLORS.length],
        latex: expression.latex,
        ...(expression.hidden ? { hidden: true } : {})
      }))
    },
    includeFunctionParametersInRandomSeed: true,
    doNotMigrateMovablePointStyle: true
  };
}

function createHash() {
  let value = "";
  while (value.length < 10) value += randomBytes(12).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "");
  return value.slice(0, 10);
}

export async function saveDesmosSnapshot(payload, { fetcher = fetch, hash = createHash(), stateSeed } = {}) {
  if (!/^[a-z0-9]{10}$/.test(hash)) throw new Error("The snapshot identifier is invalid.");
  const state = createDesmosState(payload, stateSeed);
  const response = await fetcher(DESMOS_SAVE_URL, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: { accept: "application/json", "content-type": "application/json", origin: "https://www.desmos.com", referer: "https://www.desmos.com/calculator" },
    body: JSON.stringify({ thumbnailData: payload.thumbnailData, hash, type: "quick-link", state: JSON.stringify(state), product: "graphing", lang: "en" })
  });
  if (!response.ok) throw new Error("Desmos did not accept the snapshot. This experimental feature may be temporarily unavailable.");
  return { url: `https://www.desmos.com/calculator/${hash}`, experimental: true };
}

export default async function handler(request, options = {}) {
  if (request.method !== "POST") return json(405, { error: "Use POST to create a Desmos snapshot." });
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return json(401, { error: "Sign in with an approved administrator account." });
  const env = options.env || process.env;
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return json(503, { error: "Desmos sharing is not configured yet." });
  try {
    const body = await request.text();
    if (body.length > MAX_BODY_CHARS) return json(413, { error: "The graph preview is too large to share." });
    let raw;
    try { raw = JSON.parse(body); } catch { return json(400, { error: "The graph snapshot was unreadable." }); }
    const payload = validateSnapshotPayload(raw);
    const createSupabaseClient = options.createSupabaseClient || createClient;
    const client = createSupabaseClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: auth, error: authError } = await client.auth.getUser(token);
    if (authError || !auth.user) return json(401, { error: "Your session expired. Sign in again." });
    const { data: profile, error: profileError } = await client.from("profiles").select("role,approved").eq("id", auth.user.id).single();
    if (profileError || !profile?.approved || !["admin", "editor"].includes(profile.role)) return json(403, { error: "Only approved Graphs administrators can create Desmos snapshots." });
    return json(200, await saveDesmosSnapshot(payload, { fetcher: options.fetcher, hash: options.hash, stateSeed: options.stateSeed }));
  } catch (error) {
    const timedOut = ["AbortError", "TimeoutError"].includes(error?.name);
    return json(400, { error: timedOut ? "Desmos took too long to respond. Try again." : error.message || "The Desmos snapshot could not be created." });
  }
}
