// Loopback-only preview of the static build and the existing sandboxed runner.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import run from "../netlify/functions/run.mjs";

const root = fileURLToPath(new URL("../dist/", import.meta.url));
const port = Number(process.env.ROOM310_PREVIEW_PORT || 8127);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Choose a preview port from 1024 to 65535.");
const mime = {".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"application/javascript; charset=utf-8", ".mjs":"application/javascript; charset=utf-8", ".json":"application/json", ".ipynb":"application/x-ipynb+json", ".py":"text/plain; charset=utf-8", ".png":"image/png", ".jpg":"image/jpeg", ".svg":"image/svg+xml", ".webp":"image/webp", ".woff2":"font/woff2", ".ico":"image/x-icon"};
mime[".wasm"] = "application/wasm";
mime[".zip"] = "application/zip";
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const server = createServer(async (req, res) => {
  const reply = (status, body, type = "text/plain; charset=utf-8") => {
    res.writeHead(status, {"Content-Type":type, "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff"});
    res.end(req.method === "HEAD" ? undefined : body);
  };
  try {
    if (!allowedHosts.has(req.headers.host)) return reply(403, "Use localhost to access this preview.");
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/run") {
      if (req.headers.origin && req.headers.origin !== url.origin) return reply(403, JSON.stringify({error:"Preview requests must come from this page."}), "application/json");
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 65536) return reply(413, JSON.stringify({error:"Code request is too large."}), "application/json");
        chunks.push(chunk);
      }
      const result = await run(new Request(url, {
        method:req.method, headers:req.headers,
        ...(!["GET", "HEAD"].includes(req.method) ? {body:Buffer.concat(chunks)} : {})
      }));
      return reply(result.status, await result.text(), "application/json; charset=utf-8");
    }
    if (!["GET", "HEAD"].includes(req.method)) return reply(405, "Method not allowed");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";
    // Match the production site's clean static lesson URLs.
    if (!extname(pathname)) pathname += ".html";
    const path = resolve(root, `.${pathname}`);
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) return reply(403, "Forbidden");
    if (!(await stat(path)).isFile()) return reply(404, "Not found");
    return reply(200, await readFile(path), mime[extname(path)] || "application/octet-stream");
  } catch (error) {
    const api = req.url?.split("?")[0] === "/api/run";
    reply(error.code === "ENOENT" ? 404 : 500,
      api ? JSON.stringify({error:"The preview could not complete this request."}) : "This preview file is unavailable.",
      api ? "application/json" : undefined);
  }
});
server.listen(port, "127.0.0.1", () => console.log(`Local only: http://127.0.0.1:${port}/deep-learning-study.html`));
