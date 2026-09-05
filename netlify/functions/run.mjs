const WANDBOX_URL = "https://wandbox.org/api/compile.json";
const MAX_CODE = 40_000;
const MAX_INPUT = 12_000;
const MAX_OUTPUT = 160_000;

const RUNTIMES = {
  python: "cpython-3.12.7",
  java: "openjdk-jdk-21+35",
  cpp: "gcc-13.2.0",
  javascript: "nodejs-20.17.0",
  sql: "sqlite-3.46.1",
  csharp: "mono-6.12.0.199"
};

const SQL_SEED = String.raw`
PRAGMA foreign_keys = ON;
CREATE TABLE students (student_id INTEGER PRIMARY KEY, full_name TEXT NOT NULL, grade_level INTEGER, active INTEGER DEFAULT 1);
INSERT INTO students VALUES (101,'Ana Ruiz',11,1),(102,'Marcus Chen',12,1),(103,'Leila Ortiz',10,1);
CREATE TABLE customers (customer_id INTEGER PRIMARY KEY, full_name TEXT, email TEXT, city TEXT, state_code TEXT, active INTEGER DEFAULT 1);
INSERT INTO customers VALUES (18,'Ana Ruiz','ana@example.com','Albany','NY',1),(44,'Jon Bell','jon@example.com','Brooklyn','NY',1),(77,'Leila Ortiz','leila@example.com','Newark','NJ',1),(81,'Jacob Aleo','jacob@example.com','Boston','MA',1);
CREATE TABLE orders (order_id INTEGER PRIMARY KEY, customer_id INTEGER, status TEXT, total REAL, ordered_at TEXT);
INSERT INTO orders VALUES (4501,18,'paid',72.40,'2026-08-01'),(4502,44,'pending',38.00,'2026-08-02'),(4510,44,'shipped',188.00,'2026-08-03'),(4511,44,'paid',1250.00,'2026-08-04'),(4512,81,'paid',1822.75,'2026-08-05');
CREATE TABLE order_items (product_name TEXT, unit_price REAL, quantity INTEGER);
INSERT INTO order_items VALUES ('Notebook',4.50,3),('Pencil set',3.25,2);
CREATE TABLE books (title TEXT, price REAL);
INSERT INTO books VALUES ('The Long Way Home',18.50),('Small Systems',16.00),('Expensive Reference',54.00);
CREATE TABLE contacts (full_name TEXT, phone TEXT, email TEXT);
INSERT INTO contacts VALUES ('Mara Singh',NULL,'mara@example.com'),('Jon Bell','555-0138','jon@example.com'),('No Email','555-0199',NULL);
CREATE TABLE members (full_name TEXT, points INTEGER);
INSERT INTO members VALUES ('Jacob Aleo',920),('Ana Ruiz',845),('Marcus Chen',710);
CREATE TABLE products (product_id INTEGER PRIMARY KEY, product_name TEXT, category TEXT, price REAL);
INSERT INTO products VALUES (1,'Notebook','Books',18.50),(2,'Board Game','Games',31.20),(42,'Marker Set','Art',12.00);
CREATE TABLE employees (employee_id INTEGER PRIMARY KEY, full_name TEXT, department TEXT, salary REAL, remote INTEGER, manager_id INTEGER);
INSERT INTO employees VALUES (12,'Mara Chen','Design',92000,1,20),(13,'Inez Park','Design',71000,1,20),(20,'Noah Williams','Operations',88000,0,NULL),(21,'Dev Shah','Operations',68000,0,20);
CREATE TABLE courses (course_id INTEGER PRIMARY KEY, course_name TEXT);
INSERT INTO courses VALUES (1,'Biology'),(2,'Computer Science');
CREATE TABLE enrollments (student_id INTEGER, course_id INTEGER, enrolled_on TEXT, status TEXT, PRIMARY KEY(student_id,course_id));
INSERT INTO enrollments VALUES (101,1,'2026-08-20','active'),(101,2,'2026-08-20','active'),(102,2,'2026-08-20','active');
CREATE TABLE inventory (product_id INTEGER PRIMARY KEY, quantity INTEGER);
INSERT INTO inventory VALUES (42,5);
CREATE TABLE accounts (account_id INTEGER PRIMARY KEY, balance REAL);
INSERT INTO accounts VALUES (10,500),(20,250);
`;

function json(statusCode, value) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    },
    body: JSON.stringify(value)
  };
}

function extractLeadingImports(code, pattern) {
  const imports = [];
  const body = code.replace(pattern, (match) => {
    imports.push(match.trim());
    return "";
  });
  return { imports: imports.join("\n"), body: body.trim() };
}

export function prepareCode(language, source) {
  let code = source.replace(/\r\n?/g, "\n");

  if (language === "cpp") {
    const includes = `#include <iostream>\n#include <string>\n#include <vector>\n#include <array>\n#include <map>\n#include <memory>\n#include <algorithm>\n#include <fstream>\n#include <sstream>\n#include <stdexcept>\nusing namespace std;\n`;
    if (/\b(?:int|auto)\s+main\s*\(/.test(code)) return /^\s*#\s*include\b/m.test(code) ? code : `${includes}\n${code}`;
    const body = code.replace(/^\s*#\s*include[^\n]*\n?/gm, "").trim();
    return `${includes}\nint main() {\n${body}\nreturn 0;\n}\n`;
  }

  if (language === "java") {
    code = code.replace(/^\s*package\s+[^;]+;\s*/gm, "");
    const { imports, body } = extractLeadingImports(code, /^\s*import\s+[^;]+;\s*$/gm);
    const classCode = /\bclass\s+[A-Za-z_]\w*/.test(body)
      ? body.replace(/\bpublic\s+((?:final\s+)?class\s+[A-Za-z_]\w*)/, "$1")
      : `class Main {\n  public static void main(String[] args) throws Exception {\n${body}\n  }\n}`;
    return `${imports}${imports ? "\n\n" : ""}${classCode}`;
  }

  if (language === "csharp") {
    if (/\bstatic\s+(?:async\s+)?(?:void|int|Task)\s+Main\s*\(/.test(code)) return code;
    const { imports, body } = extractLeadingImports(code, /^\s*using\s+[A-Za-z_][\w.]*\s*;\s*$/gm);
    if (/^\s*(?:(?:public|internal)\s+)?(?:class|interface|struct|enum)\b/.test(body)) return `${imports}${imports ? "\n\n" : ""}${body}`;
    return `${imports}${imports ? "\n" : ""}using System;\nclass Program {\n  static void Main() {\n${body}\n  }\n}`;
  }

  if (language === "sql") {
    const sourceCreatesSeed = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:students|enrollments)\b/i.test(code);
    code = code.replace(/\bFETCH\s+FIRST\s+(\d+)\s+ROWS\s+ONLY\b/gi, "LIMIT $1");
    return `.headers on\n.mode box\n.nullvalue NULL\n${sourceCreatesSeed ? "" : SQL_SEED}\n${code}\n`;
  }

  return code;
}

export function normalizeResult(result) {
  const stdout = [result.compiler_output, result.program_output].filter(Boolean).join("\n").slice(0, MAX_OUTPUT);
  const stderr = [result.compiler_error, result.program_error]
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_OUTPUT);
  const parsedStatus = Number.parseInt(result.status, 10);
  const exitCode = Number.isFinite(parsedStatus) ? parsedStatus : (stderr ? 1 : 0);
  return {
    stdout,
    stderr,
    exitCode,
    timedOut: /time|killed|signal/i.test(`${result.signal || ""} ${result.program_error || ""}`),
    phase: exitCode !== 0 && result.compiler_error ? "compile" : "run"
  };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return json(204, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Use POST to run code." });

  let payload;
  try {
    payload = JSON.parse(event.body || "");
  } catch {
    return json(400, { error: "The runner received invalid JSON." });
  }

  const language = typeof payload.language === "string" ? payload.language.toLowerCase() : "";
  const code = typeof payload.code === "string" ? payload.code : "";
  const input = typeof payload.input === "string" ? payload.input : "";
  if (!RUNTIMES[language]) return json(400, { error: "Choose a supported programming language." });
  if (!code.trim()) return json(400, { error: "Write some code first, then press Run." });
  if (code.length > MAX_CODE) return json(413, { error: "Code is limited to 40,000 characters per run." });
  if (input.length > MAX_INPUT) return json(413, { error: "Program input is limited to 12,000 characters per run." });

  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), 25_000);
  try {
    const response = await fetch(WANDBOX_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "Room310-v0.7 educational-runner" },
      body: JSON.stringify({
        compiler: RUNTIMES[language],
        code: prepareCode(language, code),
        stdin: input,
        save: false
      }),
      signal: abortController.signal
    });
    const text = await response.text();
    if (!response.ok) return json(502, { error: `The compiler service is temporarily unavailable (${response.status}).` });
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      return json(502, { error: "The compiler service returned an unreadable response. Please try again." });
    }
    return json(200, normalizeResult(result));
  } catch (error) {
    const detail = error?.name === "AbortError"
      ? "The run took too long and was stopped. Check for an infinite loop or missing input."
      : "The compiler service could not be reached. Please try again shortly.";
    return json(502, { error: detail });
  } finally {
    clearTimeout(timer);
  }
}

export default async function run(request, context) {
  const result = await handler({
    httpMethod: request.method,
    headers: Object.fromEntries(request.headers),
    body: await request.text()
  }, context);
  return new Response(result.statusCode === 204 ? null : result.body, {
    status: result.statusCode,
    headers: result.headers
  });
}
