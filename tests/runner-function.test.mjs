import test from "node:test";
import assert from "node:assert/strict";
import run, { handler, normalizeResult, prepareCode, prepareBackupCode, normalizeBackupResult } from "../netlify/functions/run.mjs";
import { spawnSync } from "node:child_process";

test("prepareCode makes beginner snippets runnable in compiled languages", () => {
  assert.match(prepareCode("cpp", 'cout << "Hi";'), /int main\(\)/);
  assert.match(prepareCode("java", 'System.out.println("Hi");'), /class Main/);
  assert.doesNotMatch(
    prepareCode("java", "public class Main { public static void main(String[] args) {} }"),
    /public class Main/
  );
  assert.match(prepareCode("csharp", 'Console.WriteLine("Hi");'), /static void Main\(\)/);
});

test("prepareCode supplies the lesson data for SQL queries", () => {
  const code = prepareCode("sql", "SELECT full_name FROM members;");
  assert.match(code, /CREATE TABLE members/);
  assert.match(code, /Jacob Aleo/);
  assert.match(code, /\.headers on/);
});

test("normalizeResult returns the same contract as the local runner", () => {
  assert.deepEqual(normalizeResult({ status: "1", compiler_error: "bad code", program_output: "" }), {
    stdout: "",
    stderr: "bad code",
    exitCode: 1,
    timedOut: false,
    phase: "compile"
  });
});

test("runner rejects invalid requests with JSON", async () => {
  const invalidJson = await handler({ httpMethod: "POST", body: "{" });
  assert.equal(invalidJson.statusCode, 400);
  assert.match(invalidJson.headers["content-type"], /application\/json/);
  assert.match(JSON.parse(invalidJson.body).error, /invalid JSON/);

  const unsupported = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ language: "brainfuck", code: "+", input: "" })
  });
  assert.equal(unsupported.statusCode, 400);
});

test("runner converts unreadable upstream responses into a JSON error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<!DOCTYPE html>", { status: 200 });
  try {
    const response = await handler({
      httpMethod: "POST",
      body: JSON.stringify({ language: "javascript", code: "console.log(1)", input: "" })
    });
    assert.equal(response.statusCode, 502);
    assert.match(response.headers["content-type"], /application\/json/);
    assert.match(JSON.parse(response.body).error, /unreadable response/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Netlify fetch handler always returns a Response with JSON", async () => {
  const response = await run(new Request("https://projectroom310.com/api/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "not json"
  }), {});
  assert.equal(response.status, 400);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.match((await response.json()).error, /invalid JSON/);
});

test("a primary service outage falls back and forwards input without publishing code", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, payload: JSON.parse(options.body) });
    if (calls.length === 1) return new Response("Failed to start sandbox", { status: 500 });
    return Response.json({ code: 0, didExecute: true, stdout: [{ text: "Hello Ada" }], stderr: [], buildResult: { code: 0, stderr: [] } });
  };
  try {
    const result = await handler({ httpMethod: "POST", body: JSON.stringify({ language: "java", code: 'System.out.println("Hello Ada");', input: "Ada\n" }) });
    assert.equal(result.statusCode, 200);
    assert.equal(JSON.parse(result.body).stdout, "Hello Ada");
    assert.equal(JSON.parse(result.body).runner, "backup");
    assert.equal(calls[0].payload.save, false);
    assert.match(calls[1].url, /godbolt.org\/api\/compiler\/java2100\/compile$/);
    assert.equal(calls[1].payload.allowStoreCodeDebug, false);
    assert.equal(calls[1].payload.options.executeParameters.stdin, "Ada\n");
    assert.equal(calls[1].payload.options.compilerOptions.executorRequest, true);
  } finally { globalThis.fetch = originalFetch; }
});

test("student errors are returned without rerunning the program on another provider", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ status: "1", program_error: "NameError: missing" }); };
  try {
    const response = await handler({ httpMethod: "POST", body: JSON.stringify({ language: "python", code: "missing" }) });
    assert.equal(JSON.parse(response.body).exitCode, 1);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("null and non-object request bodies are rejected without contacting a compiler", async () => {
  for (const body of ["null", "[]", '"code"', "123"]) {
    const response = await handler({ httpMethod: "POST", body });
    assert.equal(response.statusCode, 400);
    assert.match(JSON.parse(response.body).error, /invalid JSON/);
  }
});

test("backup normalization distinguishes compile errors, runtime errors, and false successes", () => {
  const compile = normalizeBackupResult({ code: -1, didExecute: false, buildResult: { code: 1, stderr: [{ text: "\u001b[31mexpected ;\u001b[0m" }] } });
  assert.equal(compile.phase, "compile");
  assert.equal(compile.exitCode, 1);
  assert.equal(compile.stderr, "expected ;");
  const runtime = normalizeBackupResult({ code: 1, didExecute: true, stdout: [{ text: "before error" }], stderr: [{ text: "ZeroDivisionError" }], buildResult: { code: 0 } });
  assert.equal(runtime.phase, "run");
  assert.equal(runtime.stdout, "before error");
  assert.throws(() => normalizeBackupResult({ code: 0, didExecute: false }), /did not execute/);
  assert.throws(() => normalizeBackupResult({}), /invalid result/);
  assert.equal(normalizeBackupResult({ code: -1, didExecute: true, timedOut: true }).timedOut, true);
});

test("SQL backup executes real SQLite, including practice data and multi-statement strings", () => {
  const source = prepareBackupCode("sql", `CREATE TABLE notes (body TEXT); INSERT INTO notes VALUES ('hello; world'); SELECT body FROM notes; SELECT full_name FROM students WHERE student_id = 101;`);
  const result = spawnSync("python3", ["-c", source], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /hello; world/);
  assert.match(result.stdout, /Ana Ruiz/);
  const invalid = spawnSync("python3", ["-c", prepareBackupCode("sql", "SELECT * FROM missing_table;")], { encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /SQLite error: no such table/);
});

test("backup timeouts and missing execution results remain JSON failures", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const failure of [new DOMException("Timed out", "TimeoutError"), { code: 0, didExecute: false }]) {
      let calls = 0;
      globalThis.fetch = async () => {
        if (++calls === 1) return new Response("down", { status: 503 });
        if (failure instanceof Error) throw failure;
        return Response.json(failure);
      };
      const response = await handler({ httpMethod: "POST", body: JSON.stringify({ language: "python", code: "print(310)" }) });
      assert.equal(response.statusCode, 502);
      assert.ok(JSON.parse(response.body).error);
    }
  } finally { globalThis.fetch = originalFetch; }
});
