import test from "node:test";
import assert from "node:assert/strict";
import run, { handler, normalizeResult, prepareCode } from "../netlify/functions/run.mjs";

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
