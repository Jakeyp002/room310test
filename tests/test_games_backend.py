from __future__ import annotations

import io
import json
import tempfile
import threading
import unittest
import uuid
import zipfile
from http.client import HTTPConnection
from http.cookies import SimpleCookie
from pathlib import Path

import run_server
from games_backend import GamesService


PASSWORD = "correct horse battery staple"
PNG_1X1 = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c6360f8cff0000004010100f51c0d470000000049454e44ae426082"
)


def zip_bytes(files: dict[str, bytes | str]) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return output.getvalue()


def multipart(field: str, filename: str, content_type: str, data: bytes) -> tuple[bytes, str]:
    boundary = f"room310-{uuid.uuid4().hex}"
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"{filename}\"\r\n"
        f"Content-Type: {content_type}\r\n\r\n"
    ).encode() + data + f"\r\n--{boundary}--\r\n".encode()
    return body, f"multipart/form-data; boundary={boundary}"


class GamesHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temp = tempfile.TemporaryDirectory()
        cls.service = GamesService(Path(cls.temp.name), "http://127.0.0.1:8001")
        cls.admin = cls.service.create_user("test-admin", PASSWORD, "admin", True)
        cls.pending = cls.service.create_user("pending-editor", PASSWORD, "editor", False)
        run_server.GAMES = cls.service
        cls.server = run_server.ThreadingHTTPServer(("127.0.0.1", 0), run_server.Room310Handler)
        cls.port = cls.server.server_address[1]
        run_server.PUBLIC_ORIGIN = f"http://127.0.0.1:{cls.port}"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.asset_server = run_server.ThreadingHTTPServer(("127.0.0.1", 0), run_server.GameAssetHandler)
        cls.asset_port = cls.asset_server.server_address[1]
        cls.asset_thread = threading.Thread(target=cls.asset_server.serve_forever, daemon=True)
        cls.asset_thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.asset_server.shutdown()
        cls.server.server_close()
        cls.asset_server.server_close()
        cls.temp.cleanup()

    def request(self, method: str, path: str, body: bytes | str | None = None, headers: dict | None = None, asset: bool = False):
        connection = HTTPConnection("127.0.0.1", self.asset_port if asset else self.port, timeout=10)
        if isinstance(body, str):
            body = body.encode()
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        data = response.read()
        response_headers = response.getheaders()
        connection.close()
        return response.status, response_headers, data

    def login(self, username: str) -> tuple[str, str, dict]:
        status, headers, body = self.request(
            "POST", "/api/auth/login", json.dumps({"username": username, "password": PASSWORD}),
            {"Content-Type": "application/json", "Origin": run_server.PUBLIC_ORIGIN},
        )
        self.assertEqual(status, 200, body)
        cookies = SimpleCookie()
        for name, value in headers:
            if name.lower() == "set-cookie":
                cookies.load(value)
        cookie_header = "; ".join(f"{name}={morsel.value}" for name, morsel in cookies.items())
        return cookie_header, cookies["room310_csrf"].value, json.loads(body)

    def admin_headers(self, cookie: str, csrf: str, content_type: str = "application/json") -> dict:
        return {"Cookie": cookie, "X-CSRF-Token": csrf, "Origin": run_server.PUBLIC_ORIGIN, "Content-Type": content_type}

    @staticmethod
    def external_payload(title: str, status: str = "draft") -> dict:
        return {"title": title, "description": "A safe external test game.", "year": 2026, "hostType": "external", "externalUrl": "https://example.com/play", "status": status}

    @staticmethod
    def hosted_payload(title: str, status: str = "draft") -> dict:
        return {"title": title, "description": "A tiny uploaded web game.", "year": 2026, "hostType": "hosted", "externalUrl": "", "status": status}

    def test_unauthenticated_and_unapproved_users_cannot_write(self) -> None:
        payload = json.dumps(self.external_payload("Forbidden game"))
        status, _, _ = self.request("POST", "/api/admin/games", payload, {"Content-Type": "application/json", "Origin": run_server.PUBLIC_ORIGIN})
        self.assertEqual(status, 401)
        cookie, csrf, login = self.login("pending-editor")
        self.assertFalse(login["user"]["approved"])
        status, _, _ = self.request("POST", "/api/admin/games", payload, self.admin_headers(cookie, csrf))
        self.assertEqual(status, 403)

    def test_approved_admin_external_game_crud_and_public_visibility(self) -> None:
        cookie, csrf, _ = self.login("test-admin")
        create = self.external_payload("Space Potato")
        status, _, body = self.request("POST", "/api/admin/games", json.dumps(create), self.admin_headers(cookie, csrf))
        self.assertEqual(status, 201, body)
        game = json.loads(body)["game"]
        self.assertEqual(game["slug"], "space-potato")

        status, _, body = self.request("GET", "/api/games")
        self.assertEqual(status, 200)
        self.assertNotIn(game["slug"], [item["slug"] for item in json.loads(body)["games"]])

        publish = {**create, "title": "Space Potato Deluxe", "status": "published"}
        status, _, body = self.request("PUT", f"/api/admin/games/{game['id']}", json.dumps(publish), self.admin_headers(cookie, csrf))
        self.assertEqual(status, 200, body)
        self.assertEqual(json.loads(body)["game"]["slug"], "space-potato")
        status, _, body = self.request("GET", "/api/games")
        public = next(item for item in json.loads(body)["games"] if item["slug"] == game["slug"])
        self.assertEqual(public["title"], "Space Potato Deluxe")
        self.assertEqual(public["playUrl"], "https://example.com/play")

        status, _, _ = self.request("DELETE", f"/api/admin/games/{game['id']}", headers=self.admin_headers(cookie, csrf))
        self.assertEqual(status, 200)
        _, _, body = self.request("GET", "/api/games")
        self.assertNotIn(game["slug"], [item["slug"] for item in json.loads(body)["games"]])

    def test_slug_collisions_and_unsafe_external_urls(self) -> None:
        cookie, csrf, _ = self.login("test-admin")
        created = []
        for title in ("Same Name", "Same Name"):
            status, _, body = self.request("POST", "/api/admin/games", json.dumps(self.external_payload(title)), self.admin_headers(cookie, csrf))
            self.assertEqual(status, 201, body)
            created.append(json.loads(body)["game"])
        self.assertEqual([game["slug"] for game in created], ["same-name", "same-name-2"])
        unsafe = {**self.external_payload("Unsafe"), "externalUrl": "javascript:alert(1)"}
        status, _, _ = self.request("POST", "/api/admin/games", json.dumps(unsafe), self.admin_headers(cookie, csrf))
        self.assertEqual(status, 400)
        for game in created:
            self.request("DELETE", f"/api/admin/games/{game['id']}", headers=self.admin_headers(cookie, csrf))

    def test_hosted_bundle_thumbnail_publication_and_asset_isolation(self) -> None:
        cookie, csrf, _ = self.login("test-admin")
        payload = self.hosted_payload("Tiny Hosted Game")
        status, _, body = self.request("POST", "/api/admin/games", json.dumps(payload), self.admin_headers(cookie, csrf))
        self.assertEqual(status, 201, body)
        game = json.loads(body)["game"]

        status, _, _ = self.request("PUT", f"/api/admin/games/{game['id']}", json.dumps({**payload, "status": "published"}), self.admin_headers(cookie, csrf))
        self.assertEqual(status, 400)
        status, _, _ = self.request("GET", f"/{game['slug']}/index.html", asset=True)
        self.assertEqual(status, 404)

        bundle = zip_bytes({
            "index.html": '<!doctype html><link rel="stylesheet" href="style.css"><div id="score">0</div><script src="game.js"></script>',
            "style.css": "html,body{margin:0;overflow:hidden;background:#111;color:#fff}",
            "game.js": "document.querySelector('#score').textContent='Ready';",
        })
        body_data, content_type = multipart("bundle", "tiny-game.zip", "application/zip", bundle)
        status, _, body = self.request("POST", f"/api/admin/games/{game['id']}/bundle", body_data, self.admin_headers(cookie, csrf, content_type))
        self.assertEqual(status, 200, body)
        thumb_data, thumb_type = multipart("thumbnail", "cover.png", "image/png", PNG_1X1)
        status, _, body = self.request("POST", f"/api/admin/games/{game['id']}/thumbnail", thumb_data, self.admin_headers(cookie, csrf, thumb_type))
        self.assertEqual(status, 200, body)

        status, _, body = self.request("PUT", f"/api/admin/games/{game['id']}", json.dumps({**payload, "status": "published"}), self.admin_headers(cookie, csrf))
        self.assertEqual(status, 200, body)
        status, _, body = self.request("GET", "/api/games")
        public = next(item for item in json.loads(body)["games"] if item["slug"] == game["slug"])
        self.assertEqual(public["playUrl"], f"/games/play/{game['slug']}/")
        self.assertTrue(public["thumbnailUrl"])

        status, headers, body = self.request("GET", f"/{game['slug']}/index.html", asset=True)
        self.assertEqual(status, 200)
        self.assertIn(b"game.js", body)
        header_map = {name.lower(): value for name, value in headers}
        self.assertIn("frame-ancestors", header_map["content-security-policy"])
        self.assertNotIn("set-cookie", header_map)
        status, _, shell = self.request("GET", f"/games/play/{game['slug']}/")
        self.assertEqual(status, 200)
        self.assertIn(b"sandbox=", shell)
        self.assertIn(b"overflow:hidden", shell)
        self.assertNotIn(b"allow-same-origin", shell)

        status, _, body = self.request("GET", public["thumbnailUrl"])
        self.assertEqual(status, 200)
        self.assertTrue(body.startswith(b"\x89PNG"))
        self.request("DELETE", f"/api/admin/games/{game['id']}", headers=self.admin_headers(cookie, csrf))

    def test_zip_path_traversal_is_rejected(self) -> None:
        cookie, csrf, _ = self.login("test-admin")
        payload = self.hosted_payload("Traversal Test")
        _, _, body = self.request("POST", "/api/admin/games", json.dumps(payload), self.admin_headers(cookie, csrf))
        game = json.loads(body)["game"]
        dangerous = zip_bytes({"index.html": "safe", "../outside.js": "bad"})
        body_data, content_type = multipart("bundle", "danger.zip", "application/zip", dangerous)
        status, _, _ = self.request("POST", f"/api/admin/games/{game['id']}/bundle", body_data, self.admin_headers(cookie, csrf, content_type))
        self.assertEqual(status, 400)
        self.assertFalse((Path(self.temp.name).parent / "outside.js").exists())
        self.request("DELETE", f"/api/admin/games/{game['id']}", headers=self.admin_headers(cookie, csrf))


if __name__ == "__main__":
    unittest.main()
