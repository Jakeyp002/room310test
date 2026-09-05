"""Secure, dependency-free game catalog, admin authentication, and upload storage."""

from __future__ import annotations

import hashlib
import hmac
import io
import json
import os
import re
import secrets
import shutil
import sqlite3
import stat
import tempfile
import unicodedata
import zipfile
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from email import policy
from email.parser import BytesParser
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit


APP_VERSION = "0.6"
SESSION_COOKIE = "room310_session"
CSRF_COOKIE = "room310_csrf"
MAX_JSON_BYTES = 128 * 1024
MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024
MAX_BUNDLE_BYTES = 20 * 1024 * 1024
MAX_BUNDLE_EXPANDED_BYTES = 80 * 1024 * 1024
MAX_BUNDLE_FILES = 1000

ALLOWED_BUNDLE_EXTENSIONS = {
    ".html", ".htm", ".js", ".mjs", ".css", ".json", ".map", ".wasm",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico",
    ".mp3", ".wav", ".ogg", ".m4a", ".mp4", ".webm",
    ".ttf", ".otf", ".woff", ".woff2", ".txt", ".xml", ".csv",
    ".gltf", ".glb", ".bin",
}


class AppError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def slugify(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", ascii_value.lower()).strip("-")[:70] or "game"


def validate_external_url(value: str) -> str:
    value = value.strip()
    if len(value) > 2048 or any(ord(character) < 32 for character in value):
        raise AppError("Enter a valid HTTP or HTTPS game URL.")
    try:
        parsed = urlsplit(value)
        _ = parsed.port
    except ValueError as error:
        raise AppError("Enter a valid HTTP or HTTPS game URL.") from error
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise AppError("External games must use a safe HTTP or HTTPS URL without embedded credentials.")
    return value


def hash_password(password: str) -> str:
    if len(password) < 12:
        raise AppError("Passwords must contain at least 12 characters.")
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=32768, r=8, p=1, dklen=32, maxmem=64 * 1024 * 1024)
    return f"scrypt$32768$8$1${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, n, r, p, salt, expected = encoded.split("$")
        if algorithm != "scrypt":
            return False
        actual = hashlib.scrypt(
            password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=len(bytes.fromhex(expected)), maxmem=64 * 1024 * 1024
        )
        return hmac.compare_digest(actual, bytes.fromhex(expected))
    except (ValueError, TypeError):
        return False


def detect_thumbnail(data: bytes) -> tuple[str, str]:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png", "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg", "image/jpeg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return ".gif", "image/gif"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp", "image/webp"
    raise AppError("Thumbnail must be a PNG, JPEG, GIF, or WebP image.")


def parse_multipart(content_type: str, body: bytes) -> tuple[dict[str, str], dict[str, dict]]:
    if not content_type.lower().startswith("multipart/form-data;"):
        raise AppError("Use multipart/form-data for uploads.", 415)
    message = BytesParser(policy=policy.default).parsebytes(
        f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode() + body
    )
    if not message.is_multipart():
        raise AppError("The upload form could not be read.")
    fields: dict[str, str] = {}
    files: dict[str, dict] = {}
    for part in message.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if not name or not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_-]{0,40}", name):
            continue
        payload = part.get_payload(decode=True) or b""
        filename = part.get_filename()
        if filename is None:
            fields[name] = payload.decode("utf-8", errors="strict")
        else:
            files[name] = {
                "filename": Path(filename).name,
                "content_type": part.get_content_type(),
                "data": payload,
            }
    return fields, files


class GamesService:
    def __init__(self, data_dir: Path, asset_origin: str, session_hours: int = 12):
        self.data_dir = data_dir.resolve()
        self.db_path = self.data_dir / "room310.sqlite3"
        self.thumbnail_dir = self.data_dir / "game-thumbnails"
        self.bundle_dir = self.data_dir / "game-bundles"
        self.asset_origin = asset_origin.rstrip("/")
        self.session_hours = max(1, min(session_hours, 168))
        for directory in (self.data_dir, self.thumbnail_dir, self.bundle_dir):
            directory.mkdir(parents=True, exist_ok=True)
            try:
                directory.chmod(0o700)
            except OSError:
                pass
        self.init_schema()

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.db_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def init_schema(self) -> None:
        with self.connect() as database:
            database.executescript(
                """
                PRAGMA journal_mode = WAL;
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY,
                    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
                    display_name TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL CHECK(role IN ('admin', 'editor')),
                    approved INTEGER NOT NULL DEFAULT 0 CHECK(approved IN (0, 1)),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    csrf_hash TEXT NOT NULL,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS games (
                    id INTEGER PRIMARY KEY,
                    title TEXT NOT NULL,
                    slug TEXT NOT NULL UNIQUE,
                    description TEXT NOT NULL,
                    year INTEGER NOT NULL CHECK(year BETWEEN 1900 AND 2100),
                    thumbnail_filename TEXT,
                    status TEXT NOT NULL CHECK(status IN ('draft', 'published')),
                    host_type TEXT NOT NULL CHECK(host_type IN ('external', 'hosted')),
                    external_url TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    created_by INTEGER NOT NULL REFERENCES users(id),
                    updated_by INTEGER NOT NULL REFERENCES users(id)
                );
                CREATE INDEX IF NOT EXISTS games_public_order ON games(status, year DESC, created_at DESC);
                CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
                """
            )

    def create_user(self, username: str, password: str, role: str = "editor", approved: bool = False, display_name: str = "") -> dict:
        username = username.strip().lower()
        if not re.fullmatch(r"[a-z0-9_.-]{3,40}", username):
            raise AppError("Username must be 3-40 letters, numbers, dots, dashes, or underscores.")
        if role not in {"admin", "editor"}:
            raise AppError("Role must be admin or editor.")
        display_name = (display_name.strip() or username)[:80]
        password_hash = hash_password(password)
        now = utc_now()
        try:
            with self.connect() as database:
                cursor = database.execute(
                    "INSERT INTO users(username, display_name, password_hash, role, approved, created_at, updated_at) VALUES(?,?,?,?,?,?,?)",
                    (username, display_name, password_hash, role, int(approved), now, now),
                )
                user_id = cursor.lastrowid
        except sqlite3.IntegrityError as error:
            raise AppError("That username already exists.") from error
        return self.get_user(user_id)

    def get_user(self, user_id: int) -> dict:
        with self.connect() as database:
            row = database.execute(
                "SELECT id, username, display_name, role, approved, created_at, updated_at FROM users WHERE id = ?", (user_id,)
            ).fetchone()
        if not row:
            raise AppError("User not found.", 404)
        result = dict(row)
        result["approved"] = bool(result["approved"])
        return result

    def list_users(self) -> list[dict]:
        with self.connect() as database:
            rows = database.execute(
                "SELECT id, username, display_name, role, approved, created_at, updated_at FROM users ORDER BY username"
            ).fetchall()
        return [{**dict(row), "approved": bool(row["approved"])} for row in rows]

    def set_user_approval(self, username: str, approved: bool) -> dict:
        now = utc_now()
        with self.connect() as database:
            cursor = database.execute(
                "UPDATE users SET approved = ?, updated_at = ? WHERE username = ? COLLATE NOCASE",
                (int(approved), now, username.strip()),
            )
            if not cursor.rowcount:
                raise AppError("User not found.", 404)
            row = database.execute("SELECT id FROM users WHERE username = ? COLLATE NOCASE", (username.strip(),)).fetchone()
            if not approved:
                database.execute("DELETE FROM sessions WHERE user_id = ?", (row["id"],))
        return self.get_user(row["id"])

    def authenticate(self, username: str, password: str) -> dict | None:
        with self.connect() as database:
            row = database.execute("SELECT * FROM users WHERE username = ? COLLATE NOCASE", (username.strip(),)).fetchone()
        if not row or not verify_password(password, row["password_hash"]):
            return None
        return self.get_user(row["id"])

    def create_session(self, user_id: int) -> tuple[str, str, str]:
        token = secrets.token_urlsafe(32)
        csrf = secrets.token_urlsafe(24)
        now = datetime.now(timezone.utc).replace(microsecond=0)
        expires = now + timedelta(hours=self.session_hours)
        with self.connect() as database:
            database.execute("DELETE FROM sessions WHERE expires_at <= ?", (now.isoformat(),))
            database.execute(
                "INSERT INTO sessions(token_hash, csrf_hash, user_id, created_at, expires_at) VALUES(?,?,?,?,?)",
                (hashlib.sha256(token.encode()).hexdigest(), hashlib.sha256(csrf.encode()).hexdigest(), user_id, now.isoformat(), expires.isoformat()),
            )
        return token, csrf, expires.isoformat()

    def session_user(self, token: str | None) -> tuple[dict, str] | None:
        if not token:
            return None
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        now = utc_now()
        with self.connect() as database:
            row = database.execute(
                """SELECT u.id, u.username, u.display_name, u.role, u.approved, u.created_at, u.updated_at,
                          s.csrf_hash, s.expires_at
                   FROM sessions s JOIN users u ON u.id = s.user_id
                   WHERE s.token_hash = ? AND s.expires_at > ?""",
                (token_hash, now),
            ).fetchone()
        if not row:
            return None
        user = {key: row[key] for key in ("id", "username", "display_name", "role", "approved", "created_at", "updated_at")}
        user["approved"] = bool(user["approved"])
        return user, row["csrf_hash"]

    def require_manager(self, token: str | None, csrf: str | None = None) -> dict:
        session = self.session_user(token)
        if not session:
            raise AppError("Sign in to manage games.", 401)
        user, csrf_hash = session
        if not user["approved"] or user["role"] not in {"admin", "editor"}:
            raise AppError("This account is not approved to manage games.", 403)
        if csrf is not None and not hmac.compare_digest(hashlib.sha256(csrf.encode()).hexdigest(), csrf_hash):
            raise AppError("The security token is missing or expired. Refresh and try again.", 403)
        return user

    def delete_session(self, token: str | None) -> None:
        if not token:
            return
        with self.connect() as database:
            database.execute("DELETE FROM sessions WHERE token_hash = ?", (hashlib.sha256(token.encode()).hexdigest(),))

    def unique_slug(self, title: str) -> str:
        base = slugify(title)
        with self.connect() as database:
            candidate = base
            suffix = 2
            while database.execute("SELECT 1 FROM games WHERE slug = ?", (candidate,)).fetchone():
                candidate = f"{base[:64]}-{suffix}"
                suffix += 1
        return candidate

    def bundle_ready(self, slug: str) -> bool:
        return (self.bundle_dir / slug / "index.html").is_file()

    def validate_game(self, payload: dict, current: sqlite3.Row | None = None) -> dict:
        if not isinstance(payload, dict):
            raise AppError("Game data must be a JSON object.")
        title = str(payload.get("title", "")).strip()
        description = str(payload.get("description", "")).strip()
        if not 2 <= len(title) <= 120:
            raise AppError("Title must contain 2-120 characters.")
        if not 1 <= len(description) <= 500:
            raise AppError("Description must contain 1-500 characters.")
        try:
            year = int(payload.get("year"))
        except (TypeError, ValueError) as error:
            raise AppError("Year must be a whole number.") from error
        if not 1900 <= year <= 2100:
            raise AppError("Year must be between 1900 and 2100.")
        status_value = str(payload.get("status", "draft"))
        host_type = str(payload.get("hostType", "external"))
        if status_value not in {"draft", "published"}:
            raise AppError("Status must be draft or published.")
        if host_type not in {"external", "hosted"}:
            raise AppError("Hosting type must be external or hosted.")
        external_url = validate_external_url(str(payload.get("externalUrl", ""))) if host_type == "external" else None
        if status_value == "published" and host_type == "hosted":
            if current is None or not self.bundle_ready(current["slug"]):
                raise AppError("Upload a hosted game bundle before publishing this game.")
        return {"title": title, "description": description, "year": year, "status": status_value, "host_type": host_type, "external_url": external_url}

    def create_game(self, payload: dict, user_id: int) -> dict:
        game = self.validate_game(payload)
        game["slug"] = self.unique_slug(game["title"])
        now = utc_now()
        with self.connect() as database:
            cursor = database.execute(
                """INSERT INTO games(title, slug, description, year, status, host_type, external_url, created_at, updated_at, created_by, updated_by)
                   VALUES(:title,:slug,:description,:year,:status,:host_type,:external_url,:created_at,:updated_at,:created_by,:updated_by)""",
                {**game, "created_at": now, "updated_at": now, "created_by": user_id, "updated_by": user_id},
            )
            game_id = cursor.lastrowid
        return self.get_admin_game(game_id)

    def update_game(self, game_id: int, payload: dict, user_id: int) -> dict:
        with self.connect() as database:
            current = database.execute("SELECT * FROM games WHERE id = ?", (game_id,)).fetchone()
            if not current:
                raise AppError("Game not found.", 404)
        game = self.validate_game(payload, current)
        with self.connect() as database:
            database.execute(
                """UPDATE games SET title=:title, description=:description, year=:year, status=:status,
                   host_type=:host_type, external_url=:external_url, updated_at=:updated_at, updated_by=:updated_by WHERE id=:id""",
                {**game, "updated_at": utc_now(), "updated_by": user_id, "id": game_id},
            )
        return self.get_admin_game(game_id)

    def get_admin_game(self, game_id: int) -> dict:
        with self.connect() as database:
            row = database.execute("SELECT * FROM games WHERE id = ?", (game_id,)).fetchone()
        if not row:
            raise AppError("Game not found.", 404)
        return self.admin_game(row)

    def admin_game(self, row: sqlite3.Row) -> dict:
        return {
            "id": row["id"], "title": row["title"], "slug": row["slug"], "description": row["description"],
            "year": row["year"], "status": row["status"], "hostType": row["host_type"],
            "externalUrl": row["external_url"] or "", "hasThumbnail": bool(row["thumbnail_filename"]),
            "thumbnailUrl": f"/api/admin/games/{row['id']}/thumbnail" if row["thumbnail_filename"] else None,
            "bundleReady": self.bundle_ready(row["slug"]), "createdAt": row["created_at"], "updatedAt": row["updated_at"],
        }

    def list_admin_games(self) -> list[dict]:
        with self.connect() as database:
            rows = database.execute("SELECT * FROM games ORDER BY updated_at DESC, id DESC").fetchall()
        return [self.admin_game(row) for row in rows]

    def public_game(self, row: sqlite3.Row) -> dict:
        play_url = row["external_url"] if row["host_type"] == "external" else f"/games/play/{row['slug']}/"
        return {
            "title": row["title"], "slug": row["slug"], "description": row["description"], "year": row["year"],
            "hostType": row["host_type"], "playUrl": play_url,
            "thumbnailUrl": f"/media/games/{row['slug']}/thumbnail" if row["thumbnail_filename"] else None,
            "dateAdded": row["created_at"], "dateUpdated": row["updated_at"],
        }

    def list_public_games(self) -> list[dict]:
        with self.connect() as database:
            rows = database.execute("SELECT * FROM games WHERE status = 'published' ORDER BY year DESC, created_at DESC").fetchall()
        return [self.public_game(row) for row in rows if row["host_type"] == "external" or self.bundle_ready(row["slug"])]

    def get_public_game(self, slug: str) -> dict:
        with self.connect() as database:
            row = database.execute("SELECT * FROM games WHERE slug = ? AND status = 'published'", (slug,)).fetchone()
        if not row or (row["host_type"] == "hosted" and not self.bundle_ready(row["slug"])):
            raise AppError("Game not found.", 404)
        return self.public_game(row)

    def delete_game(self, game_id: int) -> None:
        with self.connect() as database:
            row = database.execute("SELECT * FROM games WHERE id = ?", (game_id,)).fetchone()
            if not row:
                raise AppError("Game not found.", 404)
            database.execute("DELETE FROM games WHERE id = ?", (game_id,))
        if row["thumbnail_filename"]:
            thumbnail = (self.thumbnail_dir / row["thumbnail_filename"]).resolve()
            if thumbnail.parent == self.thumbnail_dir and thumbnail.exists():
                thumbnail.unlink()
        bundle = (self.bundle_dir / row["slug"]).resolve()
        if bundle.parent == self.bundle_dir and bundle.is_dir():
            shutil.rmtree(bundle)

    def install_thumbnail(self, game_id: int, data: bytes) -> dict:
        if not data or len(data) > MAX_THUMBNAIL_BYTES:
            raise AppError("Thumbnail must be between 1 byte and 5 MB.")
        extension, _ = detect_thumbnail(data)
        with self.connect() as database:
            row = database.execute("SELECT * FROM games WHERE id = ?", (game_id,)).fetchone()
            if not row:
                raise AppError("Game not found.", 404)
        filename = f"game-{game_id}{extension}"
        destination = self.thumbnail_dir / filename
        handle, temp_name = tempfile.mkstemp(prefix=".thumbnail-", dir=self.thumbnail_dir)
        try:
            with os.fdopen(handle, "wb") as output:
                output.write(data)
            os.replace(temp_name, destination)
        finally:
            if os.path.exists(temp_name):
                os.unlink(temp_name)
        old = row["thumbnail_filename"]
        if old and old != filename:
            old_path = (self.thumbnail_dir / old).resolve()
            if old_path.parent == self.thumbnail_dir and old_path.exists():
                old_path.unlink()
        with self.connect() as database:
            database.execute("UPDATE games SET thumbnail_filename = ?, updated_at = ? WHERE id = ?", (filename, utc_now(), game_id))
        return self.get_admin_game(game_id)

    def install_bundle(self, game_id: int, data: bytes) -> dict:
        if not data or len(data) > MAX_BUNDLE_BYTES:
            raise AppError("Hosted game ZIP must be between 1 byte and 20 MB.")
        with self.connect() as database:
            game = database.execute("SELECT * FROM games WHERE id = ?", (game_id,)).fetchone()
            if not game:
                raise AppError("Game not found.", 404)
            if game["host_type"] != "hosted":
                raise AppError("Change the game type to hosted before uploading a bundle.")
        try:
            archive = zipfile.ZipFile(io.BytesIO(data))
        except zipfile.BadZipFile as error:
            raise AppError("The hosted game must be a valid ZIP file.") from error
        files = [member for member in archive.infolist() if not member.is_dir()]
        if not files or len(files) > MAX_BUNDLE_FILES:
            raise AppError(f"Hosted game ZIP must contain 1-{MAX_BUNDLE_FILES} files.")
        if sum(member.file_size for member in files) > MAX_BUNDLE_EXPANDED_BYTES:
            raise AppError("Hosted game expands beyond the 80 MB safety limit.")
        names: list[tuple[zipfile.ZipInfo, PurePosixPath]] = []
        for member in files:
            name = member.filename.replace("\\", "/")
            path = PurePosixPath(name)
            mode = (member.external_attr >> 16) & 0o170000
            unsafe_part = any(len(part) > 255 or ":" in part or any(ord(character) < 32 for character in part) for part in path.parts)
            if member.flag_bits & 1 or mode == stat.S_IFLNK or not name or len(name) > 700 or name.startswith("/") or "\x00" in name or ".." in path.parts or unsafe_part:
                raise AppError("Hosted game ZIP contains an unsafe filename, link, or encrypted file.")
            if path.suffix.lower() not in ALLOWED_BUNDLE_EXTENSIONS:
                raise AppError(f"File type {path.suffix or '(none)'} is not allowed in hosted game bundles.")
            names.append((member, path))
        normalized_paths = [path for _, path in names]
        if PurePosixPath("index.html") not in normalized_paths:
            roots = {path.parts[0] for path in normalized_paths if len(path.parts) > 1}
            if len(roots) == 1 and PurePosixPath(next(iter(roots)), "index.html") in normalized_paths:
                names = [(member, PurePosixPath(*path.parts[1:])) for member, path in names]
            else:
                raise AppError("Hosted game ZIP needs an index.html file at its top level.")
        if len({str(path).lower() for _, path in names}) != len(names):
            raise AppError("Hosted game ZIP contains duplicate filenames.")
        incoming = Path(tempfile.mkdtemp(prefix=".incoming-", dir=self.bundle_dir)).resolve()
        destination = (self.bundle_dir / game["slug"]).resolve()
        backup = (self.bundle_dir / f".backup-{game['slug']}-{secrets.token_hex(5)}").resolve()
        try:
            for member, relative in names:
                target = (incoming / Path(*relative.parts)).resolve()
                if not target.is_relative_to(incoming):
                    raise AppError("Hosted game ZIP tried to write outside its storage folder.")
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(member) as source, target.open("wb") as output:
                    shutil.copyfileobj(source, output)
            if not (incoming / "index.html").is_file():
                raise AppError("Hosted game ZIP needs an index.html file.")
            if destination.exists():
                os.replace(destination, backup)
            os.replace(incoming, destination)
            if backup.exists():
                shutil.rmtree(backup)
        except Exception:
            if incoming.exists():
                shutil.rmtree(incoming)
            if backup.exists() and not destination.exists():
                os.replace(backup, destination)
            raise
        with self.connect() as database:
            database.execute("UPDATE games SET updated_at = ? WHERE id = ?", (utc_now(), game_id))
        return self.get_admin_game(game_id)

    def thumbnail_path_for_public(self, slug: str) -> tuple[Path, str]:
        with self.connect() as database:
            row = database.execute("SELECT thumbnail_filename FROM games WHERE slug = ? AND status = 'published'", (slug,)).fetchone()
        if not row or not row["thumbnail_filename"]:
            raise AppError("Thumbnail not found.", 404)
        return self._thumbnail_file(row["thumbnail_filename"])

    def thumbnail_path_for_admin(self, game_id: int) -> tuple[Path, str]:
        with self.connect() as database:
            row = database.execute("SELECT thumbnail_filename FROM games WHERE id = ?", (game_id,)).fetchone()
        if not row or not row["thumbnail_filename"]:
            raise AppError("Thumbnail not found.", 404)
        return self._thumbnail_file(row["thumbnail_filename"])

    def _thumbnail_file(self, filename: str) -> tuple[Path, str]:
        path = (self.thumbnail_dir / filename).resolve()
        if path.parent != self.thumbnail_dir or not path.is_file():
            raise AppError("Thumbnail not found.", 404)
        return path, detect_thumbnail(path.read_bytes()[:16])[1]

    def asset_path(self, request_path: str) -> Path:
        clean = request_path.split("?", 1)[0].lstrip("/")
        parts = PurePosixPath(clean).parts
        if not parts or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,79}", parts[0]) or ".." in parts:
            raise AppError("Game asset not found.", 404)
        slug = parts[0]
        with self.connect() as database:
            row = database.execute("SELECT host_type, status FROM games WHERE slug = ?", (slug,)).fetchone()
        if not row or row["status"] != "published" or row["host_type"] != "hosted":
            raise AppError("Game asset not found.", 404)
        root = (self.bundle_dir / slug).resolve()
        relative = Path(*parts[1:]) if len(parts) > 1 else Path("index.html")
        path = (root / relative).resolve()
        if not path.is_relative_to(root):
            raise AppError("Game asset not found.", 404)
        if path.is_dir():
            path = path / "index.html"
        if not path.is_file():
            raise AppError("Game asset not found.", 404)
        return path


def json_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
