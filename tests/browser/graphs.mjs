// Isolated UI regression test: fake auth/catalog/storage, real Desmos importer and iframe.
// Run after npm run build. Set PLAYWRIGHT_MODULE to an installed playwright module.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { importGraph } from "../../netlify/functions/graph-import.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const artifacts = await mkdtemp(`${tmpdir()}/room310-v08-qa-`);
const graph = await importGraph("https://www.desmos.com/calculator/fmxds1uvhe");
const png = Buffer.from(graph.thumbnail.split(",")[1], "base64");
const user = { id: "00000000-0000-4000-8000-000000000008", email: "qa@example.test", aud: "authenticated", role: "authenticated" };
const token = [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url"), Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated" })).toString("base64url"), "test-signature"].join(".");
const session = { access_token: token, refresh_token: "test-refresh", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer", user };
let rows = [];
let nextId = 1;
let uploads = 0;
let loginRequests = 0;
const errors = [];
const diagnostics = [];

const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname === "/supabase-config.js") {
      res.setHeader("content-type", "application/javascript");
      res.end('window.ROOM310_SUPABASE_CONFIG={projectUrl:"https://room310-graph-qa.supabase.co",publishableKey:"test-publishable-key"}');
      return;
    }
    if (pathname === "/api/graphs/import") {
      const body = [];
      for await (const chunk of req) body.push(chunk);
      const { source } = JSON.parse(Buffer.concat(body));
      const result = await importGraph(source);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(result));
      return;
    }
    const redirects = { "/": "/index.html", "/admin/graphs": "/admin-graphs.html", "/admin/login": "/admin-login.html", "/admin/games": "/admin-games.html", "/graphs": "/graphs.html" };
    const file = redirects[pathname] || (pathname.startsWith("/graphs/") ? "/graph.html" : pathname);
    const path = resolve("dist", `.${file}`);
    if (!path.startsWith(resolve("dist") + "/")) throw new Error("Invalid path");
    const body = await readFile(path);
    res.setHeader("content-type", ({ ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png" })[extname(path)] || "application/octet-stream");
    res.end(body);
  } catch (error) { res.statusCode = 404; res.end(error.message); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.route("https://room310-graph-qa.supabase.co/**", async route => {
  const request = route.request();
  const url = new URL(request.url());
  const method = request.method();
  const reply = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (url.pathname.endsWith("/auth/v1/user")) return reply(user);
  if (url.pathname.endsWith("/auth/v1/token")) { loginRequests++; return reply({ code: "invalid_credentials", msg: "Invalid login credentials" }, 400); }
  if (url.pathname.endsWith("/rest/v1/profiles")) return reply({ ...user, display_name: "UI test administrator", approved: true, role: "admin" });
  if (url.pathname.endsWith("/rest/v1/graphs")) {
    const matching = () => rows.filter(row => ["id", "slug", "status"].every(key => !url.searchParams.has(key) || String(row[key]) === url.searchParams.get(key).replace(/^eq\./, "")));
    let data;
    if (method === "GET") data = matching();
    if (method === "POST") {
      const row = { ...request.postDataJSON(), id: nextId++, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      rows.push(row);
      data = [row];
    }
    if (method === "PATCH") { data = matching(); for (const row of data) Object.assign(row, request.postDataJSON()); }
    if (method === "DELETE") { const targets = matching(); rows = rows.filter(row => !targets.includes(row)); data = []; }
    if (request.headers().accept?.includes("vnd.pgrst.object")) return reply(data[0]);
    return reply(data);
  }
  if (url.pathname.includes("/storage/v1/object/sign/") && method === "POST") return reply({ signedURL: url.pathname.replace("/storage/v1", "") + "?token=test" });
  if (url.pathname.includes("/storage/v1/object/sign/") && method === "GET") return route.fulfill({ contentType: "image/png", body: png });
  if (url.pathname.includes("/storage/v1/object/") && method === "POST") { uploads++; return reply({ Key: "test-cover" }); }
  if (url.pathname.includes("/storage/v1/object/") && method === "DELETE") return reply([]);
  throw new Error(`Unhandled mock request ${method} ${url.pathname}`);
});
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => { if (message.type() === "error") diagnostics.push(message.text()); });
page.on("requestfailed", request => diagnostics.push(`${request.url()}: ${request.failure()?.errorText}`));
page.on("dialog", dialog => dialog.accept());
const visible = async selector => { await page.locator(selector).waitFor({ state: "visible" }); };
const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Horizontal overflow");

try {
  await page.goto(`${base}/admin/graphs`);
  await page.waitForURL("**/admin/login?next=**");
  await page.locator('[name="email"]').fill("qa@example.test");
  await page.locator('[name="password"]').fill("short");
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => document.body.textContent.includes("Invalid login credentials"));
  assert.equal(loginRequests, 1, "Short existing passwords must reach sign-in, not length validation");
  await page.evaluate(session => localStorage.setItem("sb-room310-graph-qa-auth-token", JSON.stringify(session)), session);
  await page.goto(`${base}/admin/graphs`);
  await page.getByRole("button", { name: "+ Add graph" }).click();
  await visible("#graph-editor");
  assert.equal(await page.locator("#custom-cover-field").isVisible(), false);
  await page.locator('[name="source"]').fill("https://evil.test/calculator/fmxds1uvhe");
  await page.locator("#import-graph").click();
  await page.waitForFunction(() => document.querySelector("#import-message").textContent.includes("Use a saved graph"));
  await page.locator('[name="source"]').fill(`<iframe src="${graph.url}?embed"></iframe>`);
  await page.locator("#import-graph").click();
  await page.waitForFunction(() => document.querySelector("#import-message").textContent.includes("Graph imported"));
  assert.equal(await page.locator('[name="title"]').inputValue(), "Parabolas: Vertex Form");
  await visible("#cover-preview");
  assert.equal(await page.locator("#cover-image").evaluate(image => image.naturalWidth > 0), true);
  await page.locator('[name="description"]').fill("Move the sliders to explore a parabola.");
  await noOverflow();
  await page.screenshot({ path: `${artifacts}/admin-desktop.png`, fullPage: true });
  await page.getByRole("button", { name: "Save graph", exact: true }).click();
  await page.locator("#graph-editor").waitFor({ state: "hidden" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "draft");
  assert.equal(rows[0].thumbnail_source, "automatic");
  assert.ok(rows[0].thumbnail_path);
  assert.equal(uploads, 1);
  await page.goto(`${base}/graphs`);
  await page.getByText("Graphs are on their way.").waitFor();
  await page.goto(`${base}/admin/graphs`);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("button", { name: "Unpublish", exact: true }).waitFor();
  await page.goto(`${base}/graphs`);
  await page.getByRole("link", { name: "Explore graph →" }).waitFor();
  await noOverflow();
  await page.screenshot({ path: `${artifacts}/gallery-desktop.png`, fullPage: true });
  await page.getByRole("link", { name: "Explore graph →" }).click();
  await page.waitForURL(`**/graphs/${rows[0].slug}`);
  await page.locator("#graph-stage iframe").waitFor();
  assert.equal(await page.locator("#graph-stage iframe").getAttribute("src"), graph.url);
  const desmosFrame = page.frameLocator("#graph-stage iframe");
  try { await desmosFrame.locator("canvas.dcg-graph-inner").waitFor({ timeout: 20000 }); }
  catch (error) {
    console.log({ frameText: await desmosFrame.locator("body").innerText(), diagnostics, errors });
    await page.screenshot({ path: `${artifacts}/graph-load-failure.png` });
    throw error;
  }
  assert.match(await desmosFrame.locator("body").innerText(), /adjusting the a, h and k values/);
  await noOverflow();
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true, "Graph workspace should fit the viewport");
  await page.screenshot({ path: `${artifacts}/graph-desktop.png` });
  await page.getByRole("button", { name: "Reload graph" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow();
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true);
  await page.screenshot({ path: `${artifacts}/graph-mobile.png` });
  await page.goto(`${base}/graphs`);
  await page.getByRole("link", { name: "Explore graph →" }).waitFor();
  await noOverflow();
  await page.screenshot({ path: `${artifacts}/gallery-mobile.png`, fullPage: true });
  assert.equal(await page.locator('.header nav a[aria-current="page"]').isVisible(), true);
  await page.goto(`${base}/admin/graphs`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator('[name="coverSource"]').selectOption("custom");
  await visible("#custom-cover-field");
  await page.locator('[name="thumbnail"]').setInputFiles({ name: "custom.png", mimeType: "image/png", buffer: png });
  await page.waitForFunction(() => document.querySelector("#cover-image").src.startsWith("blob:"));
  await noOverflow();
  await page.screenshot({ path: `${artifacts}/admin-mobile.png`, fullPage: true });
  await page.getByRole("button", { name: "Save graph", exact: true }).click();
  await page.locator("#graph-editor").waitFor({ state: "hidden" });
  assert.equal(rows[0].thumbnail_source, "custom");
  assert.equal(uploads, 2);
  await page.getByRole("button", { name: "Unpublish", exact: true }).click();
  await page.getByRole("button", { name: "Publish", exact: true }).waitFor();
  await page.goto(`${base}/graphs/${rows[0].slug}`);
  await page.getByRole("heading", { name: "Graph unavailable" }).waitFor();
  await page.goto(`${base}/admin/graphs`);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByText("No graphs yet.", { exact: false }).waitFor();
  assert.equal(rows.length, 0);
  assert.deepEqual(errors, [], "No frontend exceptions");
  console.log(JSON.stringify({ result: "Browser checks passed", artifacts, uploads, loginRequests, frontendErrors: errors.length }));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
