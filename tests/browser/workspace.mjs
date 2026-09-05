// Real end-to-end compiler checks. Set BASE_URL to test a deployed site;
// otherwise this serves the built site and its Netlify runner locally.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import run from "../../netlify/functions/run.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const artifacts = await mkdtemp(`${tmpdir()}/room310-workspace-qa-`);
let server;
let base = process.env.BASE_URL;
if (!base) {
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://localhost").pathname;
      if (pathname === "/api/run") {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const result = await run(new Request("http://localhost/api/run", { method: request.method, body: Buffer.concat(chunks) }));
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(await result.text());
        return;
      }
      const file = resolve("dist", `.${pathname}${extname(pathname) ? "" : ".html"}`);
      if (!file.startsWith(resolve("dist") + "/")) throw new Error("Invalid path");
      response.setHeader("content-type", ({ ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".wasm": "application/wasm" })[extname(file)] || "application/octet-stream");
      response.end(await readFile(file));
    } catch (error) { response.statusCode = 404; response.end(error.message); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}
const cases = [
  ["python", "lesson-1-first-program", 'name = input()\nprint("Hello " + name)', "Hello Ada"],
  ["java", "java-1-first-program", 'import java.util.Scanner;\nSystem.out.println("Hello " + new Scanner(System.in).nextLine());', "Hello Ada"],
  ["cpp", "cpp-1-programs-types-and-console-i-o", 'string name;\ngetline(cin, name);\ncout << "Hello " << name << endl;', "Hello Ada"],
  ["csharp", "csharp-1-net-programs-types-and-input", 'Console.WriteLine("Hello " + Console.ReadLine());', "Hello Ada"],
  ["javascript", "javascript-1-values-variables-and-functions", 'console.log("Hello " + ["Ada"][0]);', "Hello Ada"],
  ["sql", "sql-1-relational-data-and-select", 'SELECT full_name FROM students ORDER BY student_id;', "Ana Ruiz"]
];
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(50_000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const editor = page.locator(".assignment-workspace-editor");
const output = page.locator(".assignment-workspace-output");
const runButton = page.locator(".assignment-workspace-run");
async function finish() { await page.waitForFunction(() => document.querySelector(".assignment-workspace-panel").dataset.state === "idle"); }
try {
  for (const [language, path, source, expected] of cases) {
    await page.goto(`${base}/${path}`, { waitUntil: "domcontentloaded" });
    await page.locator(".assignment-workspace-launch").click();
    assert.equal(await page.locator(".assignment-workspace-language").inputValue(), language);
    await editor.fill(source);
    await page.locator(".assignment-workspace-input-wrap summary").click();
    await page.locator(".assignment-workspace-input").fill("Ada\n");
    await runButton.click();
    await finish();
    const result = await output.innerText();
    assert.ok(result.includes(expected), `${language}: ${result}`);
    assert.equal(await page.locator(".assignment-workspace-status").textContent(), "Finished");
    assert.equal(await page.locator(".assignment-workspace-language").isEnabled(), true);
    console.log(`${language}: real execution passed`);
  }
  await page.locator(".assignment-workspace-language").selectOption("python");
  await editor.fill("print(1 / 0)");
  await runButton.click();
  await finish();
  assert.match(await output.innerText(), /ZeroDivisionError/);
  assert.equal(await page.locator(".assignment-workspace-status").textContent(), "Fix an error");
  await editor.fill('print("recovered")');
  await runButton.click();
  await finish();
  assert.match(await output.innerText(), /recovered/);
  await page.screenshot({ path: `${artifacts}/desktop.png` });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".assignment-workspace-launch").click();
  assert.equal(await editor.inputValue(), 'print("recovered")');
  assert.equal(await page.locator(".assignment-workspace-language").inputValue(), "python");

  // These isolated transport failures must not lose drafts or wedge the run button.
  await page.route("**/api/run", route => route.fulfill({ status: 502, contentType: "text/html", body: "<!DOCTYPE html><h1>Down</h1>" }));
  await runButton.click();
  await finish();
  assert.match(await output.innerText(), /unreadable response/);
  assert.equal(await editor.inputValue(), 'print("recovered")');
  await page.unroute("**/api/run");
  await page.route("**/api/run", () => {});
  await runButton.click();
  await page.getByRole("button", { name: "Stop", exact: true }).waitFor();
  assert.equal(await page.locator(".assignment-workspace-language").isDisabled(), true);
  await runButton.click();
  await finish();
  assert.match(await output.innerText(), /Stopped/);
  await page.unroute("**/api/run");
  await runButton.click();
  await finish();
  assert.match(await output.innerText(), /recovered/);

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator(".assignment-workspace-version").isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const bounds = await page.locator(".assignment-workspace-panel").boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y + bounds.height <= 845);
  await page.screenshot({ path: `${artifacts}/mobile.png` });
  await page.locator(".assignment-workspace-close").click();
  await page.locator(".assignment-workspace-panel").waitFor({ state: "hidden" });
  await page.evaluate(() => localStorage.setItem(`room310-assignment-v0.2:${location.pathname}`, "null"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".assignment-workspace-launch").click();
  assert.equal(await page.locator(".assignment-workspace-language").inputValue(), "sql");
  assert.deepEqual(errors, [], "No frontend errors");
  console.log(JSON.stringify({ result: "Workspace browser checks passed", base, artifacts }));
} finally {
  await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
}
