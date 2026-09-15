// End-to-end Assignment Help UI and context checks against the built site.
// Set PLAYWRIGHT_MODULE to a Playwright module file when it is not installed locally.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const artifacts = await mkdtemp(`${tmpdir()}/room310-assignment-help-qa-`);
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname === "/supabase-config.js") {
      response.setHeader("content-type", "application/javascript");
      response.end('window.ROOM310_SUPABASE_CONFIG={projectUrl:"https://fake-ref.supabase.co",publishableKey:"test-publishable-key"};');
      return;
    }
    const filename = resolve("dist", `.${pathname}${extname(pathname) ? "" : ".html"}`);
    if (!filename.startsWith(`${resolve("dist")}/`)) throw new Error("Invalid path");
    response.setHeader("content-type", ({ ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".wasm": "application/wasm" })[extname(filename)] || "application/octet-stream");
    response.end(await readFile(filename));
  } catch (error) {
    response.statusCode = 404;
    response.end(error.message);
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}`;

const base64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const expiresAt = Math.floor(Date.now() / 1000) + 3_600;
const accessToken = `${base64url({ alg: "HS256", typ: "JWT" })}.${base64url({
  aud: "authenticated",
  exp: expiresAt,
  sub: "00000000-0000-4000-8000-000000000310",
  email: "student@room310.test",
  role: "authenticated"
})}.test-signature`;
const storedSession = {
  access_token: accessToken,
  token_type: "bearer",
  expires_in: 3_600,
  expires_at: expiresAt,
  refresh_token: "test-refresh-token",
  user: {
    id: "00000000-0000-4000-8000-000000000310",
    aud: "authenticated",
    role: "authenticated",
    email: "student@room310.test",
    is_anonymous: false
  }
};

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
page.setDefaultTimeout(15_000);
await page.addInitScript((session) => {
  if (location.hostname === "127.0.0.1") localStorage.setItem("sb-fake-ref-auth-token", JSON.stringify(session));
}, storedSession);
const requests = [];
let confirmationNumber = 0;
await page.route("**/api/study", async (route) => {
  const payload = route.request().postDataJSON();
  requests.push(payload);
  const latest = payload.messages.at(-1)?.content || "";
  if (/full solution/i.test(latest) && !payload.solutionConfirmation) {
    confirmationNumber += 1;
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        confirmationRequired: true,
        message: "Choose another hint, or explicitly reveal the solution for this assignment.",
        confirmationToken: `test-token-${confirmationNumber}.signature`
      })
    });
    return;
  }
  const answer = payload.solutionConfirmation?.decision === "answer"
    ? "Here is the confirmed solution with an explanation."
    : payload.solutionConfirmation?.decision === "hint"
      ? "Try one more hint: compare the prompt with the expected output."
      : "Look closely at the quotation marks on line 1.";
  await route.fulfill({
    status: 200,
    contentType: "application/x-ndjson; charset=utf-8",
    body: `${JSON.stringify({ type: "meta", remaining: 24 })}\n${JSON.stringify({ type: "delta", text: answer })}\n${JSON.stringify({ type: "done" })}\n`
  });
});

const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
try {
  await page.goto(`${base}/lesson-1-first-program.html`, { waitUntil: "networkidle" });
  await page.locator(".assignment-help-launch").waitFor();
  assert.equal(await page.locator(".assignment-workspace-launch").isVisible(), true);
  assert.equal(await page.locator(".assignment-help-launch").isVisible(), true);

  const firstContext = await page.evaluate(() => window.Room310AssignmentWorkspace.getContext());
  assert.match(firstContext.assignmentTitle, /^A1\.1/i);
  assert.match(firstContext.instructions, /favorite/i);
  assert.equal(firstContext.language, "python");
  assert.equal(Object.hasOwn(firstContext, "html"), false);

  await page.locator(".assignment-help-launch").click();
  await page.locator(".assignment-help-chat").waitFor();
  assert.equal(await page.locator(".assignment-workspace-panel").isHidden(), true);
  assert.match(await page.locator(".assignment-help-context-title").innerText(), /^A1\.1/i);
  await page.locator("#assignment-help-input").fill("Why isn't this working?");
  await page.locator(".assignment-help-send").click();
  await page.getByText("Look closely at the quotation marks on line 1.").waitFor();
  assert.equal(requests[0].mode, "assignment_help");
  assert.match(requests[0].assignmentContext.assignmentTitle, /^A1\.1/i);
  assert.match(requests[0].assignmentContext.instructions, /favorite/i);

  await page.locator(".assignment-help-switch").click();
  assert.equal(await page.locator(".assignment-help-panel").isHidden(), true);
  assert.equal(await page.locator(".assignment-workspace-panel").isVisible(), true);
  const updatedCode = "favorite = input('Favorite?')\nprint(favorite)";
  await page.locator(".assignment-workspace-editor").fill(updatedCode);
  await page.locator(".assignment-workspace-close").click();
  await page.locator(".assignment-help-launch").click();
  await page.locator("#assignment-help-input").fill("Check my latest code.");
  await page.locator(".assignment-help-send").click();
  await page.locator(".assignment-help-message-body").filter({ hasText: "Look closely at the quotation marks on line 1." }).nth(1).waitFor();
  assert.equal(requests.at(-1).assignmentContext.currentCode, updatedCode);

  await page.evaluate(() => window.Room310AssignmentWorkspace.open());
  assert.equal(await page.locator(".assignment-help-panel").isHidden(), true);
  assert.equal(await page.locator(".assignment-workspace-panel").isVisible(), true);
  await page.evaluate(() => window.Room310AssignmentHelp.open());
  assert.equal(await page.locator(".assignment-workspace-panel").isHidden(), true);
  assert.equal(await page.locator(".assignment-help-panel").isVisible(), true);

  await page.locator("#assignment-help-input").fill("Please give me the full solution code.");
  await page.locator(".assignment-help-send").click();
  await page.getByText("This will reveal part or all of the assignment solution.").waitFor();
  assert.equal(requests.at(-1).solutionConfirmation, undefined);
  await page.getByRole("button", { name: "Give me another hint" }).click();
  await page.getByText(/Try one more hint/).waitFor();
  assert.equal(requests.at(-1).solutionConfirmation.decision, "hint");

  await page.locator("#assignment-help-input").fill("Please give me the full solution code.");
  await page.locator(".assignment-help-send").click();
  await page.getByRole("button", { name: "Show me the answer" }).click();
  await page.getByText(/confirmed solution/).waitFor();
  assert.equal(requests.at(-1).solutionConfirmation.decision, "answer");

  await page.screenshot({ path: `${artifacts}/desktop.png` });
  const desktopBounds = await page.locator(".assignment-help-panel").boundingBox();
  assert.ok(desktopBounds.x >= 0 && desktopBounds.x + desktopBounds.width <= 1440);

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const mobileBounds = await page.locator(".assignment-help-panel").boundingBox();
  assert.ok(mobileBounds.x >= 0 && mobileBounds.x + mobileBounds.width <= 390 && mobileBounds.y + mobileBounds.height <= 845);
  await page.screenshot({ path: `${artifacts}/mobile.png` });

  await page.goto(`${base}/study.html`, { waitUntil: "networkidle" });
  assert.equal(await page.locator(".assignment-help-launch").count(), 0);
  await page.goto(`${base}/javascript-1-values-variables-and-functions.html`, { waitUntil: "networkidle" });
  const structuredContext = await page.evaluate(() => window.Room310AssignmentWorkspace.getContext());
  assert.equal(structuredContext.metadata.source, "structured");
  assert.match(structuredContext.assignmentTitle, /^A1\.1/i);
  assert.match(structuredContext.instructions, /profile script/i);
  assert.equal((structuredContext.instructions.match(/Submit readable source code/g) || []).length, 1);
  assert.equal(await page.locator(".assignment-help-launch").isVisible(), true);
  await page.goto(`${base}/deep-learning-3-pytorch-and-tensors.html`, { waitUntil: "networkidle" });
  assert.equal(await page.locator(".assignment-help-launch").count(), 0);
  assert.deepEqual(pageErrors, [], "No frontend page errors");
  console.log(JSON.stringify({ result: "Assignment Help browser checks passed", base, requests: requests.length, artifacts }));
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
