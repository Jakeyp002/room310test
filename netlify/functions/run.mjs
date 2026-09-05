const WANDBOX_URL = "https://wandbox.org/api/compile.json";
const EXPLORER_URL = "https://godbolt.org/api/compiler";
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

const BACKUP_RUNTIMES = {
  python: { compiler: "python312", language: "python", label: "Python 3.12" },
  java: { compiler: "java2100", language: "java", label: "Java 21" },
  cpp: { compiler: "g132", language: "c++", label: "C++ / GCC 13.2" },
  javascript: { compiler: "v8113", language: "javascript", label: "JavaScript / V8 (Node.js modules are unavailable in backup mode)" },
  sql: { compiler: "python312", language: "python", label: "SQLite" },
  csharp: { compiler: "dotnet80csharpcoreclr", language: "csharp", label: "C# / .NET 8" }
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

export function prepareBackupCode(language, source) {
  if (language !== "sql") return prepareCode(language, source);
  // SQLite itself executes the SQL. Python is only the driver's sandboxed host.
  const sql = prepareCode("sql", source).replace(/^\.headers on\n\.mode box\n\.nullvalue NULL\n/, "");
  return `import json, sqlite3, sys
connection = sqlite3.connect(":memory:", isolation_level=None)
source = json.loads(${JSON.stringify(JSON.stringify(sql))})
def execute(statement):
    cursor = connection.execute(statement)
    if cursor.description:
        print(" | ".join(column[0] for column in cursor.description))
        for index, row in enumerate(cursor):
            if index >= 1000:
                print("[Output limited to 1,000 rows]")
                break
            print(" | ".join("NULL" if value is None else str(value) for value in row))
try:
    statement = ""
    for character in source:
        statement += character
        if character == ";" and sqlite3.complete_statement(statement):
            execute(statement)
            statement = ""
    if statement.strip():
        execute(statement)
except sqlite3.Error as error:
    print("SQLite error: " + str(error), file=sys.stderr)
    sys.exit(1)
finally:
    connection.close()
`;
}

const outputLines = (lines) => (Array.isArray(lines) ? lines.map(line => typeof line?.text === "string" ? line.text : "").join("\n") : "").replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").slice(0, MAX_OUTPUT);

export function normalizeBackupResult(result) {
  if (!result || typeof result !== "object" || !Number.isInteger(result.code)) throw new Error("The backup runner returned an invalid result.");
  const build = result.buildResult;
  if (!result.didExecute && !(build && Number.isInteger(build.code) && build.code !== 0) && result.code === 0) throw new Error("The backup runner did not execute the program.");
  const buildFailed = Boolean(build && build.code !== 0);
  return {
    stdout: outputLines(result.stdout),
    stderr: [outputLines(build?.stderr), outputLines(result.stderr)].filter(Boolean).join("\n").slice(0, MAX_OUTPUT),
    exitCode: buildFailed ? build.code : result.code,
    timedOut: Boolean(result.timedOut || build?.timedOut),
    phase: buildFailed ? "compile" : "run"
  };
}

async function runWandbox(language, code, input) {
  const response = await fetch(WANDBOX_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Room310-v0.9 educational-runner" },
    body: JSON.stringify({ compiler: RUNTIMES[language], code: prepareCode(language, code), stdin: input, save: false }),
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) throw new Error("Primary compiler service unavailable.");
  const result = JSON.parse(await response.text());
  if (!result || typeof result !== "object" || !["string", "number"].includes(typeof result.status) || !Number.isFinite(Number(result.status))) throw new Error("Primary compiler returned an unreadable response.");
  return normalizeResult(result);
}

async function runBackup(language, code, input) {
  const runtime = BACKUP_RUNTIMES[language];
  const response = await fetch(`${EXPLORER_URL}/${runtime.compiler}/compile`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      source: prepareBackupCode(language, code),
      lang: runtime.language,
      allowStoreCodeDebug: false,
      options: {
        userArguments: language === "cpp" ? "-std=c++17" : "",
        compilerOptions: { executorRequest: true },
        filters: { execute: true },
        executeParameters: { args: [], stdin: input }
      }
    }),
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error("Backup compiler service unavailable.");
  const result = normalizeBackupResult(JSON.parse(await response.text()));
  return { ...result, runner: "backup", runtime: runtime.label };
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

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return json(400, { error: "The runner received invalid JSON. Send a code request object." });

  const language = typeof payload.language === "string" ? payload.language.toLowerCase() : "";
  const code = typeof payload.code === "string" ? payload.code : "";
  const input = typeof payload.input === "string" ? payload.input : "";
  if (!Object.hasOwn(RUNTIMES, language)) return json(400, { error: "Choose a supported programming language." });
  if (!code.trim()) return json(400, { error: "Write some code first, then press Run." });
  if (code.length > MAX_CODE) return json(413, { error: "Code is limited to 40,000 characters per run." });
  if (input.length > MAX_INPUT) return json(413, { error: "Program input is limited to 12,000 characters per run." });

  try {
    return json(200, await runWandbox(language, code, input));
  } catch {
    // Only infrastructure failures fall back. A student's compile/runtime error
    // is returned normally and must never cause a second execution.
    try {
      return json(200, await runBackup(language, code, input));
    } catch (error) {
      const detail = ["AbortError", "TimeoutError"].includes(error?.name)
        ? "The run took too long and was stopped. Check for an infinite loop or missing input, then run again."
        : "Both compiler services are unavailable or returned an unreadable response. Your draft is safe; please try again shortly.";
      return json(502, { error: detail });
    }
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
