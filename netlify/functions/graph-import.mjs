import { createClient } from "@supabase/supabase-js";
import { parseDesmosGraph } from "../../client-src/graph-utils.js";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
const decode = (value) => value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

export function metadataFromHtml(html) {
  const meta = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) attrs[match[1].toLowerCase()] = decode(match[3]);
    if (attrs.property && attrs.content) meta[attrs.property] = attrs.content;
  }
  const image = meta["og:image"];
  if (!image) throw new Error("This graph is unavailable or has no saved preview. Open it in Desmos, save it, then copy its share link again.");
  const imageUrl = new URL(image);
  if (imageUrl.origin !== "https://www.desmos.com" || !/^\/calc_thumbs\/production\/[a-zA-Z0-9_./-]+\.png$/.test(imageUrl.pathname) || imageUrl.search || imageUrl.hash) throw new Error("Desmos returned an unsupported preview image.");
  return { title: meta["og:title"] || "Untitled graph", imageUrl: imageUrl.href };
}

async function limitedBody(response, limit) {
  if (Number(response.headers.get("content-length")) > limit) throw new Error("The graph preview is too large. Choose another graph.");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new Error("The graph preview is too large. Choose another graph."); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function importGraph(source, fetcher = fetch) {
  const graph = parseDesmosGraph(source);
  const signal = AbortSignal.timeout(15000);
  const response = await fetcher(graph.url, { redirect: "error", signal });
  if (!response.ok) throw new Error("Desmos could not open that graph. Check that its share link works.");
  const metadata = metadataFromHtml((await limitedBody(response, 1_000_000)).toString("utf8"));
  const thumbnail = await fetcher(metadata.imageUrl, { redirect: "error", signal });
  if (!thumbnail.ok || !thumbnail.headers.get("content-type")?.startsWith("image/png")) throw new Error("The graph preview could not be downloaded. Try again shortly.");
  const bytes = await limitedBody(thumbnail, 5 * 1024 * 1024);
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Desmos did not return a valid graph image.");
  return { url: graph.url, title: metadata.title, thumbnail: `data:image/png;base64,${bytes.toString("base64")}` };
}

export default async function run(request) {
  if (request.method !== "POST") return json(405, { error: "Use POST to import a graph." });
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return json(401, { error: "Sign in to import a graph." });
  const projectUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!projectUrl || !key) return json(503, { error: "Graph importing is not configured yet." });
  try {
    const client = createClient(projectUrl, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: auth, error: authError } = await client.auth.getUser(token);
    if (authError || !auth.user) return json(401, { error: "Your session expired. Sign in again." });
    const { data: profile, error: profileError } = await client.from("profiles").select("role,approved").eq("id", auth.user.id).single();
    if (profileError || !profile?.approved || !["admin", "editor"].includes(profile.role)) return json(403, { error: "Your account is not approved to manage graphs." });
    const body = await request.text();
    if (body.length > 5000) return json(413, { error: "Paste just the share link or embed code." });
    let payload;
    try { payload = JSON.parse(body); } catch { return json(400, { error: "The graph request was unreadable. Try again." }); }
    return json(200, await importGraph(payload?.source));
  } catch (error) {
    return json(400, { error: error.name === "TimeoutError" ? "Desmos took too long to respond. Try again shortly." : error.message || "The graph could not be imported." });
  }
}
