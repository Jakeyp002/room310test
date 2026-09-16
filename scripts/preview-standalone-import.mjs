import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

const manifestPath = resolve(process.argv[2] || "game-imports/100-games-pilot.json");
const assetsDirectory = resolve(process.argv[3] || ".");
const port = Number(process.env.ROOM310_STANDALONE_PREVIEW_PORT || 8131);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Choose a preview port from 1024 to 65535.");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const games = new Map(manifest.games.map((game) => [game.slug, game]));
const assetRoot = assetsDirectory.endsWith(sep) ? assetsDirectory : `${assetsDirectory}${sep}`;

function shell() {
  const gameList = JSON.stringify(manifest.games.map(({ slug, title }) => ({ slug, title })));
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Room310 standalone review</title><style>
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#08090d;color:#fff;font-family:Inter,Arial,sans-serif}body{display:grid;grid-template-rows:64px minmax(0,1fr)}header{display:flex;align-items:center;gap:12px;padding:10px 16px;background:#11131a;border-bottom:1px solid #30343f}h1{font-size:18px;margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.spacer{flex:1}button{border:0;border-radius:10px;padding:10px 14px;background:#ffca3a;color:#17120a;font-weight:800;cursor:pointer}button.secondary{background:#292e3a;color:#fff}main{min-height:0;padding:12px}.viewport{position:relative;width:100%;height:100%;overflow:hidden;border-radius:16px;background:#000;box-shadow:0 10px 34px #0008}.status{position:absolute;inset:0;display:grid;place-items:center;color:#ddd;background:#0b0c10;z-index:2}.status[hidden]{display:none}.embedded-game-frame{display:block;width:100%;height:100%;border:0;background:#000}@media(max-width:620px){body{grid-template-rows:56px minmax(0,1fr)}header{gap:8px;padding:8px}h1{display:none}button{padding:9px 10px;font-size:12px}main{padding:6px}.viewport{border-radius:10px}}
</style></head><body><header><h1 id="title">Room310 review</h1><span class="spacer"></span><button id="previous" class="secondary">Previous</button><button id="next" class="secondary">Next</button><button id="fullscreen">Fullscreen</button></header><main><section id="viewport" class="viewport"><div id="status" class="status">Loading safely…</div></section></main><script type="module">
const games=${gameList};const params=new URLSearchParams(location.search);let index=Math.max(0,games.findIndex(game=>game.slug===params.get("game")));if(index<0)index=0;const viewport=document.querySelector("#viewport");const status=document.querySelector("#status");const title=document.querySelector("#title");
async function load(){const game=games[index];title.textContent=(index+1)+" / "+games.length+" — "+game.title;status.hidden=false;status.textContent="Loading "+game.title+" safely…";viewport.querySelector("iframe")?.remove();history.replaceState(null,"","?game="+encodeURIComponent(game.slug));try{const response=await fetch("/source/"+encodeURIComponent(game.slug),{cache:"no-store",credentials:"omit",referrerPolicy:"no-referrer"});if(!response.ok)throw new Error("source unavailable");const frame=document.createElement("iframe");frame.className="embedded-game-frame";frame.title=game.title;frame.setAttribute("sandbox","allow-scripts allow-pointer-lock");frame.setAttribute("allow","fullscreen; gamepad");frame.setAttribute("referrerpolicy","no-referrer");frame.setAttribute("scrolling","no");frame.addEventListener("load",()=>{status.hidden=true},{once:true});frame.srcdoc=await response.text();viewport.append(frame)}catch(error){status.textContent="Could not load "+game.title+": "+error.message}}
document.querySelector("#previous").addEventListener("click",()=>{index=(index+games.length-1)%games.length;load()});document.querySelector("#next").addEventListener("click",()=>{index=(index+1)%games.length;load()});document.querySelector("#fullscreen").addEventListener("click",()=>viewport.requestFullscreen?.());load();
</script></body></html>`;
}

function securityShell() {
  const malicious = `<script>
try { parent.document.body.dataset.compromised = "yes"; } catch {}
try { top.location = "https://example.invalid/escaped"; } catch {}
try { document.cookie = "room310_session=stolen"; } catch {}
parent.postMessage({ type: "room310-sandbox-probe-complete" }, "*");
<\/script><p>Sandbox probe</p>`;
  const encodedMalicious = JSON.stringify(malicious).replaceAll("<", "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Room310 sandbox probe</title></head><body data-room310-session="private-parent-value"><output id="result">Checking…</output><script>
const frame=document.createElement("iframe");frame.title="Malicious sandbox probe";frame.setAttribute("sandbox","allow-scripts allow-pointer-lock");frame.setAttribute("allow","fullscreen; gamepad");frame.setAttribute("referrerpolicy","no-referrer");frame.srcdoc=${encodedMalicious};document.body.append(frame);
addEventListener("message",event=>{if(event.source!==frame.contentWindow||event.data?.type!=="room310-sandbox-probe-complete")return;const safe=document.body.dataset.compromised!=="yes"&&location.hostname==="127.0.0.1"&&!document.cookie.includes("room310_session=stolen");document.querySelector("#result").textContent=safe?"PASS: the game could not reach the parent DOM, session, or top-level navigation.":"FAIL: sandbox boundary changed."},{once:true});
setTimeout(()=>{if(document.querySelector("#result").textContent==="Checking…")document.querySelector("#result").textContent="FAIL: probe did not finish."},3000);
</script></body></html>`;
}

const server = createServer(async (request, response) => {
  const reply = (status, body, type = "text/plain; charset=utf-8") => {
    response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    response.end(body);
  };
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) return reply(403, "Use localhost.");
    if (request.method !== "GET") return reply(405, "Method not allowed.");
    if (url.pathname === "/") return reply(200, shell(), "text/html; charset=utf-8");
    if (url.pathname === "/security") return reply(200, securityShell(), "text/html; charset=utf-8");
    const match = url.pathname.match(/^\/source\/([a-z0-9-]+)$/);
    const game = match && games.get(match[1]);
    if (!game) return reply(404, "Not found.");
    const path = resolve(assetsDirectory, game.source);
    if (!path.startsWith(assetRoot)) return reply(403, "Forbidden.");
    return reply(200, await readFile(path), "text/html; charset=utf-8");
  } catch (error) {
    return reply(error.code === "ENOENT" ? 404 : 500, "Preview unavailable.");
  }
});

server.listen(port, "127.0.0.1", () => console.log(`Local standalone review: http://127.0.0.1:${port}/`));
