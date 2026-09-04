#!/usr/bin/env python3
"""Room310 static server plus small, local-only course code runner."""

from __future__ import annotations

import argparse
import getpass
import hashlib
import hmac
import html
import json
import mimetypes
import os
import re
import resource
import signal
import subprocess
import sys
import tempfile
import threading
import time
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

from games_backend import (
    APP_VERSION,
    CSRF_COOKIE,
    MAX_BUNDLE_BYTES,
    MAX_JSON_BYTES,
    MAX_THUMBNAIL_BYTES,
    SESSION_COOKIE,
    AppError,
    GamesService,
    json_bytes,
    parse_multipart,
)


ROOT = Path(__file__).resolve().parent
SITE_ROOT = ROOT / "room310files"
DOTNET = ROOT / ".runtime" / "dotnet" / "dotnet"
DOTNET_SDK = DOTNET.parent / "sdk" / "10.0.400"
CSHARP_REFS = DOTNET.parent / "packs" / "Microsoft.NETCore.App.Ref" / "10.0.11" / "ref" / "net10.0"
JAVA_HOME = Path(subprocess.check_output(["/usr/libexec/java_home"], text=True).strip())
HOST = os.environ.get("ROOM310_HOST", "127.0.0.1")
PORT = int(os.environ.get("ROOM310_PORT", "8000"))
ASSET_HOST = os.environ.get("ROOM310_ASSET_HOST", "127.0.0.1")
ASSET_PORT = int(os.environ.get("ROOM310_ASSET_PORT", "8001"))
PUBLIC_ORIGIN = os.environ.get("ROOM310_PUBLIC_ORIGIN", f"http://{HOST}:{PORT}").rstrip("/")
ASSET_ORIGIN = os.environ.get("ROOM310_ASSET_ORIGIN", f"http://{ASSET_HOST}:{ASSET_PORT}").rstrip("/")
DATA_DIR = Path(os.environ.get("ROOM310_DATA_DIR", str(ROOT / "data")))
SECURE_COOKIES = os.environ.get("ROOM310_SECURE_COOKIES", "0") == "1"
SESSION_HOURS = int(os.environ.get("ROOM310_SESSION_HOURS", "12"))
GAMES = GamesService(DATA_DIR, ASSET_ORIGIN, SESSION_HOURS)
LOGIN_FAILURES: dict[str, list[float]] = {}
LOGIN_LOCK = threading.Lock()
MAX_REQUEST = 64 * 1024
MAX_CODE = 40_000
MAX_INPUT = 12_000
MAX_OUTPUT = 160_000

LANGUAGES = {"python", "java", "cpp", "javascript", "sql", "csharp"}

SQL_SEED = r"""
PRAGMA foreign_keys = ON;
CREATE TABLE students (student_id INTEGER PRIMARY KEY, full_name TEXT NOT NULL, grade_level INTEGER, active INTEGER DEFAULT 1);
INSERT INTO students VALUES (101,'Ana Ruiz',11,1),(102,'Marcus Chen',12,1),(103,'Leila Ortiz',10,1);
CREATE TABLE customers (customer_id INTEGER PRIMARY KEY, full_name TEXT, email TEXT, city TEXT, state_code TEXT, active INTEGER DEFAULT 1);
INSERT INTO customers VALUES (18,'Ana Ruiz','ana@example.com','Albany','NY',1),(44,'Jon Bell','jon@example.com','Brooklyn','NY',1),(77,'Leila Ortiz','leila@example.com','Newark','NJ',1),(81,'Amara Okafor','amara@example.com','Boston','MA',1);
CREATE TABLE orders (order_id INTEGER PRIMARY KEY, customer_id INTEGER, status TEXT, total REAL, ordered_at TEXT);
INSERT INTO orders VALUES (4501,18,'paid',72.40,'2026-08-01'),(4502,44,'pending',38.00,'2026-08-02'),(4510,44,'shipped',188.00,'2026-08-03'),(4511,44,'paid',1250.00,'2026-08-04'),(4512,81,'paid',1822.75,'2026-08-05');
CREATE TABLE order_items (product_name TEXT, unit_price REAL, quantity INTEGER);
INSERT INTO order_items VALUES ('Notebook',4.50,3),('Pencil set',3.25,2);
CREATE TABLE books (title TEXT, price REAL);
INSERT INTO books VALUES ('The Long Way Home',18.50),('Small Systems',16.00),('Expensive Reference',54.00);
CREATE TABLE contacts (full_name TEXT, phone TEXT, email TEXT);
INSERT INTO contacts VALUES ('Mara Singh',NULL,'mara@example.com'),('Jon Bell','555-0138','jon@example.com'),('No Email','555-0199',NULL);
CREATE TABLE members (full_name TEXT, points INTEGER);
INSERT INTO members VALUES ('Amara Okafor',920),('Ana Ruiz',845),('Marcus Chen',710);
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
"""


def limits(cpu_seconds: int = 8):
    def apply_limits() -> None:
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds + 1))
        resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT, MAX_OUTPUT))
        resource.setrlimit(resource.RLIMIT_NOFILE, (512, 512))

    return apply_limits


def sandbox_profile(workdir: Path) -> str:
    return (
        '(version 1) (deny default) '
        '(allow process*) (allow signal (target self)) (allow sysctl-read) (allow mach-lookup) '
        '(allow file-read*) '
        f'(allow file-write* (subpath {json.dumps(str(workdir))}) (literal "/dev/null")) '
        '(deny network*)'
    )


def run_process(command: list[str], workdir: Path, stdin_text: str = "", timeout: int = 8, sandbox: bool = True) -> dict:
    stdout_path = workdir / "stdout.txt"
    stderr_path = workdir / "stderr.txt"
    input_path = workdir / "input.txt"
    profile_path = workdir / "sandbox.sb"
    input_path.write_text(stdin_text, encoding="utf-8")
    profile_path.write_text(sandbox_profile(workdir), encoding="utf-8")

    effective_command = ["/usr/bin/sandbox-exec", "-f", str(profile_path), *command] if sandbox else command
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": str(workdir),
        "TMPDIR": str(workdir),
        "LANG": "en_US.UTF-8",
        "LC_ALL": "en_US.UTF-8",
        "DOTNET_ROOT": str(DOTNET.parent),
        "JAVA_HOME": str(JAVA_HOME),
        "DOTNET_CLI_HOME": str(workdir),
        "DOTNET_NOLOGO": "1",
        "DOTNET_SKIP_FIRST_TIME_EXPERIENCE": "1",
        "DOTNET_CLI_TELEMETRY_OPTOUT": "1",
        "NUGET_PACKAGES": str(workdir / ".nuget"),
    }

    timed_out = False
    with input_path.open("rb") as stdin_file, stdout_path.open("wb") as stdout_file, stderr_path.open("wb") as stderr_file:
        process = subprocess.Popen(
            effective_command,
            cwd=workdir,
            stdin=stdin_file,
            stdout=stdout_file,
            stderr=stderr_file,
            env=env,
            start_new_session=True,
            preexec_fn=limits(timeout),
        )
        try:
            exit_code = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            os.killpg(process.pid, signal.SIGKILL)
            exit_code = process.wait()

    stdout = stdout_path.read_text(encoding="utf-8", errors="replace")[:MAX_OUTPUT]
    stderr = stderr_path.read_text(encoding="utf-8", errors="replace")[:MAX_OUTPUT]
    if timed_out:
        stderr = (stderr + f"\nStopped after {timeout} seconds. Check for an infinite loop or input the program is still waiting for.").strip()
    return {"stdout": stdout, "stderr": stderr, "exitCode": exit_code, "timedOut": timed_out}


def prepare_cpp(code: str) -> tuple[str, bool]:
    includes = """#include <iostream>
#include <string>
#include <vector>
#include <array>
#include <map>
#include <memory>
#include <algorithm>
#include <fstream>
#include <sstream>
#include <stdexcept>
using namespace std;
"""
    if re.search(r"\b(?:int|auto)\s+main\s*\(", code):
        prefix = "" if re.search(r"^\s*#\s*include\b", code, re.M) else includes + "\n"
        return prefix + code, True
    body = re.sub(r"^\s*#\s*include[^\n]*\n?", "", code, flags=re.M).strip()
    prefix = includes + "\n"
    top_level_definition = re.match(r"\s*(?:template\s*<|class\s+|struct\s+|enum\s+|(?:[\w:<>&*]+\s+)+\w+\s*\([^;]*\)\s*\{)", body)
    if top_level_definition:
        return prefix + body, False
    return f"{prefix}int main() {{\n{body}\nreturn 0;\n}}\n", True


def execute(language: str, code: str, user_input: str) -> dict:
    with tempfile.TemporaryDirectory(prefix="room310-cell-") as temp_name:
        workdir = Path(temp_name).resolve()

        if language == "python":
            source = workdir / "solution.py"
            source.write_text(code, encoding="utf-8")
            result = run_process([sys.executable, "-I", "-S", str(source)], workdir, user_input, timeout=5)
            result["phase"] = "run"
            return result

        if language == "javascript":
            source = workdir / "cell.mjs"
            if re.search(r"\bwait\s*\(", code) and not re.search(r"(?:function\s+wait|\bwait\s*=)", code):
                code = "const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));\n" + code
            source.write_text(code, encoding="utf-8")
            result = run_process(["node", str(source)], workdir, user_input, timeout=5)
            result["phase"] = "run"
            return result

        if language == "sql":
            source = re.sub(r"\bFETCH\s+FIRST\s+(\d+)\s+ROWS\s+ONLY\b", r"LIMIT \1", code, flags=re.I)
            creates_seed_table = re.search(r"\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:students|enrollments)\b", source, re.I)
            script = ".headers on\n.mode box\n.nullvalue NULL\n" + ("" if creates_seed_table else SQL_SEED) + "\n" + source + "\n"
            result = run_process(["/usr/bin/sqlite3", ":memory:"], workdir, script, timeout=5)
            result["phase"] = "run"
            return result

        if language == "cpp":
            if re.search(r"\b(?:std::)?(?:cin\s*>>|getline\s*\(\s*(?:std::)?cin)", code) and not user_input.strip():
                return {"stdout": "", "stderr": "This example needs input. Type the sample answers in the Input box, then run it again.", "exitCode": 1, "timedOut": False, "phase": "run"}
            prepared, should_run = prepare_cpp(code)
            source = workdir / "cell.cpp"
            source.write_text(prepared, encoding="utf-8")
            output = workdir / "cell"
            compile_command = ["/usr/bin/clang++", "-std=c++20", "-Wall", "-Wextra", "-pedantic", "-O0", str(source)]
            compile_command += ["-o", str(output)] if should_run else ["-c", "-o", str(workdir / "cell.o")]
            compiled = run_process(compile_command, workdir, timeout=12)
            if compiled["exitCode"] != 0:
                compiled["phase"] = "compile"
                return compiled
            if not should_run:
                return {"stdout": "Compiled successfully. Add a main() function to run this definition.", "stderr": compiled["stderr"], "exitCode": 0, "timedOut": False, "phase": "compile"}
            result = run_process([str(output)], workdir, user_input, timeout=5)
            result["stderr"] = (compiled["stderr"] + result["stderr"]).strip()
            result["phase"] = "run"
            return result

        if language == "java":
            if re.search(r"^\s*package\s+", code, re.M):
                return {"stdout": "", "stderr": "Package declarations are not needed in a lesson cell.", "exitCode": 1, "timedOut": False, "phase": "compile"}
            class_match = re.search(r"\bpublic\s+(?:final\s+)?class\s+([A-Za-z_]\w*)", code)
            any_class = re.search(r"\bclass\s+([A-Za-z_]\w*)", code)
            class_name = (class_match or any_class).group(1) if (class_match or any_class) else "Main"
            has_main = bool(re.search(r"\bstatic\s+void\s+main\s*\(", code))
            if not any_class:
                code = f"public class Main {{\n  public static void main(String[] args) throws Exception {{\n{code}\n  }}\n}}\n"
                class_name = "Main"
                has_main = True
            source = workdir / f"{class_name}.java"
            source.write_text(code, encoding="utf-8")
            compiled = run_process([str(JAVA_HOME / "bin" / "javac"), "-encoding", "UTF-8", "--release", "21", str(source)], workdir, timeout=12)
            if compiled["exitCode"] != 0:
                compiled["phase"] = "compile"
                return compiled
            if not has_main:
                return {"stdout": "Compiled successfully. Add main() to run this class or method.", "stderr": compiled["stderr"], "exitCode": 0, "timedOut": False, "phase": "compile"}
            result = run_process([str(JAVA_HOME / "bin" / "java"), "-cp", str(workdir), class_name], workdir, user_input, timeout=5)
            result["stderr"] = (compiled["stderr"] + result["stderr"]).strip()
            result["phase"] = "run"
            return result

        if language == "csharp":
            if not DOTNET.exists():
                return {"stdout": "", "stderr": "The project-local .NET SDK is missing.", "exitCode": 1, "timedOut": False, "phase": "compile"}
            record_with_statements = re.match(r"\s*(public\s+record\b[^;]+;)\s*(.+)$", code, re.S)
            if record_with_statements:
                code = record_with_statements.group(2).strip() + "\n\n" + record_with_statements.group(1)
            definition_only = bool(re.match(r"\s*(?:(?:public|internal)\s+)?(?:class|interface|struct|enum|record)\b", code)) and not re.search(r"\bstatic\s+void\s+Main\s*\(", code)
            (workdir / "Program.cs").write_text(code, encoding="utf-8")
            reference_names = ["mscorlib", "netstandard", "System.Runtime", "System.Console"]
            global_usings = ["System"]
            optional_references = [
                (r"\brecord\b|\b(?:List|Dictionary|HashSet|IEnumerable|IReadOnlyList|Collection)<", ["System.Collections"], ["System.Collections.Generic"]),
                (r"\b(?:Where|Select|OrderBy|OrderByDescending|GroupBy|MaxBy|ToList|Sum|Average)\s*\(", ["System.Linq", "System.Linq.Expressions"], ["System.Linq"]),
                (r"\b(?:File|Directory|Path|StreamReader|StreamWriter)\b", ["System.IO", "System.IO.FileSystem"], ["System.IO"]),
                (r"\b(?:Task|async|await)\b", ["System.Threading", "System.Threading.Tasks"], ["System.Threading.Tasks"]),
                (r"\bJson(?:Serializer|Document|Element)\b", ["System.Text.Json", "System.Memory"], ["System.Text.Json"]),
                (r"\bRegex\b", ["System.Text.RegularExpressions"], ["System.Text.RegularExpressions"]),
                (r"\bHttpClient\b", ["System.Net.Http", "System.Net.Primitives"], ["System.Net.Http"]),
            ]
            for pattern, names, namespaces in optional_references:
                if re.search(pattern, code):
                    reference_names.extend(names)
                    global_usings.extend(namespaces)
            (workdir / "GlobalUsings.cs").write_text(
                "".join(f"global using {namespace};\n" for namespace in dict.fromkeys(global_usings)),
                encoding="utf-8",
            )
            references = [f"-r:{CSHARP_REFS / (name + '.dll')}" for name in reference_names if (CSHARP_REFS / (name + '.dll')).exists()]
            output = workdir / "Room310Cell.dll"
            compiler = DOTNET_SDK / "Roslyn" / "bincore" / "csc.dll"
            compiled = run_process(
                [str(DOTNET), str(compiler), "-nologo", "-nostdlib", f"-target:{'library' if definition_only else 'exe'}", f"-out:{output}", "-langversion:latest", "-nullable:enable", *references, str(workdir / "GlobalUsings.cs"), str(workdir / "Program.cs")],
                workdir,
                timeout=30,
                sandbox=False,
            )
            if compiled["exitCode"] != 0 and not (compiled["stdout"] or compiled["stderr"]):
                compiled = run_process(
                    [str(DOTNET), str(compiler), "-nologo", "-nostdlib", f"-target:{'library' if definition_only else 'exe'}", f"-out:{output}", "-langversion:latest", "-nullable:enable", *references, str(workdir / "GlobalUsings.cs"), str(workdir / "Program.cs")],
                    workdir,
                    timeout=30,
                    sandbox=False,
                )
            if compiled["exitCode"] != 0:
                compiled["phase"] = "compile"
                return compiled
            if definition_only:
                return {"stdout": "Compiled successfully. This cell defines a reusable type; add executable statements to create and use it.", "stderr": compiled["stderr"], "exitCode": 0, "timedOut": False, "phase": "compile"}
            (workdir / "Room310Cell.runtimeconfig.json").write_text(
                '{"runtimeOptions":{"tfm":"net10.0","framework":{"name":"Microsoft.NETCore.App","version":"10.0.11"}}}',
                encoding="utf-8",
            )
            result = run_process([str(DOTNET), str(output)], workdir, user_input, timeout=5)
            result["stderr"] = (compiled["stderr"] + result["stderr"]).strip()
            result["phase"] = "run"
            return result

        raise ValueError("Unsupported language")


class Room310Handler(SimpleHTTPRequestHandler):
    """Main site, course runner, public catalog, and authenticated admin API."""

    server_version = "Room310/0.5"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(SITE_ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        super().end_headers()

    def _cookies(self) -> SimpleCookie:
        cookies = SimpleCookie()
        try:
            cookies.load(self.headers.get("Cookie", ""))
        except Exception:
            pass
        return cookies

    def _cookie_value(self, name: str) -> str | None:
        item = self._cookies().get(name)
        return item.value if item else None

    def _origin_allowed(self) -> bool:
        allowed = {PUBLIC_ORIGIN, f"http://{HOST}:{PORT}", f"http://localhost:{PORT}"}
        return self.headers.get("Origin") in allowed

    def _require_origin(self) -> None:
        if not self._origin_allowed():
            raise AppError("Cross-origin requests are not allowed.", 403)

    def _read_body(self, limit: int) -> bytes:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise AppError("Invalid request length.") from error
        if not 0 < length <= limit:
            raise AppError("Request is empty or exceeds the upload limit.", 413)
        return self.rfile.read(length)

    def _read_json(self, limit: int = MAX_JSON_BYTES) -> dict:
        if self.headers.get("Content-Type", "").split(";", 1)[0].strip() != "application/json":
            raise AppError("Use application/json.", 415)
        try:
            payload = json.loads(self._read_body(limit))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise AppError("Request contains invalid JSON.") from error
        if not isinstance(payload, dict):
            raise AppError("JSON request must be an object.")
        return payload

    def _send_bytes(self, body: bytes, status: int = 200, content_type: str = "application/json; charset=utf-8", headers: list[tuple[str, str]] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for name, value in headers or []:
            self.send_header(name, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_json(self, value: object, status: int = 200, headers: list[tuple[str, str]] | None = None) -> None:
        self._send_bytes(json_bytes(value), status, headers=headers)

    def _error(self, error: Exception) -> None:
        if isinstance(error, AppError):
            self._send_json({"error": str(error)}, error.status)
        else:
            self.log_error("Unexpected server error: %r", error)
            self._send_json({"error": "The server hit an unexpected error."}, 500)

    def _manager(self, write: bool = False) -> dict:
        token = self._cookie_value(SESSION_COOKIE)
        if not GAMES.session_user(token):
            raise AppError("Sign in to manage games.", 401)
        csrf = None
        if write:
            self._require_origin()
            csrf = self.headers.get("X-CSRF-Token", "")
            cookie_csrf = self._cookie_value(CSRF_COOKIE)
            if not csrf or not cookie_csrf or not hmac.compare_digest(csrf, cookie_csrf):
                raise AppError("The security token is missing or expired. Refresh and try again.", 403)
        return GAMES.require_manager(token, csrf)

    def _cookie_headers(self, session: str, csrf: str, max_age: int) -> list[tuple[str, str]]:
        secure = "; Secure" if SECURE_COOKIES else ""
        session_cookie = f"{SESSION_COOKIE}={session}; Path=/; Max-Age={max_age}; HttpOnly; SameSite=Strict{secure}"
        csrf_cookie = f"{CSRF_COOKIE}={csrf}; Path=/; Max-Age={max_age}; SameSite=Strict{secure}"
        return [("Set-Cookie", session_cookie), ("Set-Cookie", csrf_cookie)]

    def _serve_site_file(self, filename: str, content_security_policy: str | None = None) -> None:
        path = (SITE_ROOT / filename).resolve()
        if path.parent != SITE_ROOT or not path.is_file():
            raise AppError("Page not found.", 404)
        headers = [("Content-Security-Policy", content_security_policy)] if content_security_policy else None
        self._send_bytes(path.read_bytes(), content_type="text/html; charset=utf-8", headers=headers)

    def _serve_file(self, path: Path, content_type: str) -> None:
        self._send_bytes(path.read_bytes(), content_type=content_type)

    def _play_shell(self, slug: str) -> None:
        game = GAMES.get_public_game(slug)
        if game["hostType"] != "hosted":
            raise AppError("Game not found.", 404)
        frame_url = f"{ASSET_ORIGIN}/{quote(slug)}/index.html"
        title = html.escape(game["title"])
        body = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} · Room310 Games</title><style>
*{{box-sizing:border-box}}html,body{{width:100%;height:100%;margin:0;overflow:hidden;background:#171714;color:#f1efe7;font-family:Arial,sans-serif}}
body{{display:grid;grid-template-rows:48px minmax(0,1fr)}}header{{display:flex;align-items:center;gap:14px;padding:0 16px;border-bottom:1px solid #45453f}}
a{{color:#171714;background:#dfff00;padding:8px 11px;text-decoration:none;font:700 11px 'Courier New',monospace;text-transform:uppercase}}
strong{{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}small{{margin-left:auto;color:#dfff00;font:10px 'Courier New',monospace;text-transform:uppercase}}
iframe{{display:block;width:100%;height:100%;border:0;background:#000}}
</style></head><body><header><a href="/games.html">← Games</a><strong>{title}</strong><small>v{APP_VERSION}</small></header>
<iframe src="{html.escape(frame_url, quote=True)}" title="{title}" sandbox="allow-scripts allow-forms allow-modals allow-pointer-lock" allow="fullscreen; gamepad" scrolling="no"></iframe></body></html>"""
        frame_origin = f"{urlsplit(ASSET_ORIGIN).scheme}://{urlsplit(ASSET_ORIGIN).netloc}"
        csp = f"default-src 'none'; style-src 'unsafe-inline'; frame-src {frame_origin}; frame-ancestors 'self'; base-uri 'none'; form-action 'none'"
        self._send_bytes(body.encode(), content_type="text/html; charset=utf-8", headers=[("Content-Security-Policy", csp)])

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        try:
            if path == "/admin-games.html":
                self.send_response(303)
                self.send_header("Location", "/admin/games")
                self.end_headers()
                return
            if path == "/admin-login.html":
                self.send_response(303)
                self.send_header("Location", "/admin/login")
                self.end_headers()
                return
            if path == "/api/games":
                self._send_json({"games": GAMES.list_public_games(), "version": APP_VERSION})
                return
            if path == "/api/auth/session":
                session = GAMES.session_user(self._cookie_value(SESSION_COOKIE))
                self._send_json({"authenticated": bool(session), "user": session[0] if session else None})
                return
            if path == "/api/admin/games":
                self._manager()
                self._send_json({"games": GAMES.list_admin_games()})
                return
            admin_thumbnail = re.fullmatch(r"/api/admin/games/(\d+)/thumbnail", path)
            if admin_thumbnail:
                self._manager()
                file_path, content_type = GAMES.thumbnail_path_for_admin(int(admin_thumbnail.group(1)))
                self._serve_file(file_path, content_type)
                return
            public_thumbnail = re.fullmatch(r"/media/games/([a-z0-9][a-z0-9-]{0,79})/thumbnail", path)
            if public_thumbnail:
                file_path, content_type = GAMES.thumbnail_path_for_public(public_thumbnail.group(1))
                self._serve_file(file_path, content_type)
                return
            play = re.fullmatch(r"/games/play/([a-z0-9][a-z0-9-]{0,79})/?", path)
            if play:
                self._play_shell(play.group(1))
                return
            if path in {"/admin/login", "/admin/login/"}:
                session = GAMES.session_user(self._cookie_value(SESSION_COOKIE))
                if session and session[0]["approved"]:
                    self.send_response(303)
                    self.send_header("Location", "/admin/games")
                    self.end_headers()
                else:
                    self._serve_site_file("admin-login.html", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
                return
            if path in {"/admin/games", "/admin/games/"}:
                try:
                    self._manager()
                except AppError:
                    self.send_response(303)
                    self.send_header("Location", "/admin/login")
                    self.end_headers()
                    return
                self._serve_site_file("admin-games.html", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
                return
            super().do_GET()
        except Exception as error:
            self._error(error)

    def do_HEAD(self) -> None:
        self.do_GET()

    def do_POST(self) -> None:
        path = urlsplit(self.path).path
        try:
            if path == "/api/run":
                self._require_origin()
                payload = self._read_json(MAX_REQUEST)
                language = str(payload.get("language", ""))
                code = str(payload.get("code", ""))
                user_input = str(payload.get("input", ""))
                if language not in LANGUAGES:
                    raise AppError("Unsupported language.")
                if not code.strip() or len(code) > MAX_CODE or len(user_input) > MAX_INPUT:
                    raise AppError("Cell or input is empty or too large.")
                self._send_json(execute(language, code, user_input))
                return
            if path == "/api/auth/login":
                self._require_origin()
                client = self.client_address[0]
                now = time.monotonic()
                with LOGIN_LOCK:
                    attempts = [attempt for attempt in LOGIN_FAILURES.get(client, []) if now - attempt < 900]
                    LOGIN_FAILURES[client] = attempts
                if len(attempts) >= 8:
                    raise AppError("Too many sign-in attempts. Wait 15 minutes and try again.", 429)
                payload = self._read_json()
                username = str(payload.get("username", ""))[:80]
                password = str(payload.get("password", ""))[:500]
                user = GAMES.authenticate(username, password)
                if not user:
                    with LOGIN_LOCK:
                        LOGIN_FAILURES.setdefault(client, []).append(now)
                    raise AppError("Incorrect username or password.", 401)
                with LOGIN_LOCK:
                    LOGIN_FAILURES.pop(client, None)
                token, csrf, _ = GAMES.create_session(user["id"])
                max_age = GAMES.session_hours * 3600
                self._send_json({"user": user}, headers=self._cookie_headers(token, csrf, max_age))
                return
            if path == "/api/auth/logout":
                self._require_origin()
                token = self._cookie_value(SESSION_COOKIE)
                session = GAMES.session_user(token)
                if session:
                    csrf = self.headers.get("X-CSRF-Token", "")
                    cookie_csrf = self._cookie_value(CSRF_COOKIE) or ""
                    if not csrf or not hmac.compare_digest(csrf, cookie_csrf) or not hmac.compare_digest(hashlib.sha256(csrf.encode()).hexdigest(), session[1]):
                        raise AppError("The security token is missing or expired. Refresh and try again.", 403)
                GAMES.delete_session(token)
                self._send_json({"ok": True}, headers=self._cookie_headers("", "", 0))
                return
            if path == "/api/admin/games":
                user = self._manager(write=True)
                game = GAMES.create_game(self._read_json(), user["id"])
                self._send_json({"game": game}, 201)
                return
            thumbnail = re.fullmatch(r"/api/admin/games/(\d+)/thumbnail", path)
            if thumbnail:
                self._manager(write=True)
                body = self._read_body(MAX_THUMBNAIL_BYTES + 128 * 1024)
                _, files = parse_multipart(self.headers.get("Content-Type", ""), body)
                upload = files.get("thumbnail")
                if not upload:
                    raise AppError("Choose a thumbnail image to upload.")
                game = GAMES.install_thumbnail(int(thumbnail.group(1)), upload["data"])
                self._send_json({"game": game})
                return
            bundle = re.fullmatch(r"/api/admin/games/(\d+)/bundle", path)
            if bundle:
                self._manager(write=True)
                body = self._read_body(MAX_BUNDLE_BYTES + 256 * 1024)
                _, files = parse_multipart(self.headers.get("Content-Type", ""), body)
                upload = files.get("bundle")
                if not upload or not upload["filename"].lower().endswith(".zip"):
                    raise AppError("Choose a ZIP file containing the hosted game.")
                game = GAMES.install_bundle(int(bundle.group(1)), upload["data"])
                self._send_json({"game": game})
                return
            raise AppError("Endpoint not found.", 404)
        except Exception as error:
            self._error(error)

    def do_PUT(self) -> None:
        path = urlsplit(self.path).path
        try:
            match = re.fullmatch(r"/api/admin/games/(\d+)", path)
            if not match:
                raise AppError("Endpoint not found.", 404)
            user = self._manager(write=True)
            game = GAMES.update_game(int(match.group(1)), self._read_json(), user["id"])
            self._send_json({"game": game})
        except Exception as error:
            self._error(error)

    def do_DELETE(self) -> None:
        path = urlsplit(self.path).path
        try:
            match = re.fullmatch(r"/api/admin/games/(\d+)", path)
            if not match:
                raise AppError("Endpoint not found.", 404)
            self._manager(write=True)
            GAMES.delete_game(int(match.group(1)))
            self._send_json({"ok": True})
        except Exception as error:
            self._error(error)


class GameAssetHandler(BaseHTTPRequestHandler):
    """Published hosted-game files on an origin that never receives admin cookies."""

    server_version = "Room310GameAssets/0.5"

    def _serve(self, include_body: bool) -> None:
        try:
            path = GAMES.asset_path(unquote(urlsplit(self.path).path))
            content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            data = path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
            self.send_header("Content-Security-Policy", f"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors {PUBLIC_ORIGIN}; base-uri 'none'")
            self.end_headers()
            if include_body:
                self.wfile.write(data)
        except AppError as error:
            self.send_error(error.status, str(error))

    def do_GET(self) -> None:
        self._serve(True)

    def do_HEAD(self) -> None:
        self._serve(False)


def prompt_password() -> str:
    first = getpass.getpass("Password (12+ characters): ")
    second = getpass.getpass("Confirm password: ")
    if first != second:
        raise AppError("Passwords did not match.")
    return first


def run_cli() -> None:
    parser = argparse.ArgumentParser(description="Run Room310 or manage approved game editors.")
    subcommands = parser.add_subparsers(dest="command")
    create_admin = subcommands.add_parser("create-admin", help="Create an approved administrator")
    create_admin.add_argument("username")
    create_admin.add_argument("--display-name", default="")
    create_user = subcommands.add_parser("create-user", help="Create an unapproved editor account")
    create_user.add_argument("username")
    create_user.add_argument("--display-name", default="")
    create_user.add_argument("--role", choices=["admin", "editor"], default="editor")
    approve = subcommands.add_parser("approve-user", help="Approve an existing account")
    approve.add_argument("username")
    revoke = subcommands.add_parser("revoke-user", help="Revoke access and active sessions")
    revoke.add_argument("username")
    subcommands.add_parser("list-users", help="List accounts and approval status")
    args = parser.parse_args()

    try:
        if args.command == "create-admin":
            user = GAMES.create_user(args.username, prompt_password(), "admin", True, args.display_name)
            print(f"Created approved admin: {user['username']}")
            return
        if args.command == "create-user":
            user = GAMES.create_user(args.username, prompt_password(), args.role, False, args.display_name)
            print(f"Created {user['role']} account awaiting approval: {user['username']}")
            return
        if args.command == "approve-user":
            user = GAMES.set_user_approval(args.username, True)
            print(f"Approved: {user['username']}")
            return
        if args.command == "revoke-user":
            user = GAMES.set_user_approval(args.username, False)
            print(f"Revoked: {user['username']}")
            return
        if args.command == "list-users":
            for user in GAMES.list_users():
                print(f"{user['username']:<24} {user['role']:<8} {'approved' if user['approved'] else 'not approved'}")
            return
    except AppError as error:
        parser.error(str(error))

    try:
        execute("csharp", 'Console.WriteLine("");', "")
    except Exception:
        pass
    asset_server = ThreadingHTTPServer((ASSET_HOST, ASSET_PORT), GameAssetHandler)
    asset_thread = threading.Thread(target=asset_server.serve_forever, name="room310-game-assets", daemon=True)
    asset_thread.start()
    server = ThreadingHTTPServer((HOST, PORT), Room310Handler)
    print(f"Room310 v{APP_VERSION} is running at {PUBLIC_ORIGIN}", flush=True)
    print(f"Isolated hosted games are running at {ASSET_ORIGIN}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        asset_server.shutdown()
        asset_server.server_close()


if __name__ == "__main__":
    run_cli()
