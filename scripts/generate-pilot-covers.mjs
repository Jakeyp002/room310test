import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const run = promisify(execFile);
const manifestPath = resolve(process.argv[2] || "game-imports/100-games-pilot.json");
const assetsDirectory = resolve(process.argv[3] || dirname(manifestPath));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const colors = [
  ["#ffca3a", "#ff595e"], ["#1982c4", "#6a4c93"], ["#8ac926", "#1982c4"],
  ["#ff595e", "#6a4c93"], ["#00b4d8", "#0077b6"], ["#ff9f1c", "#e71d36"],
  ["#7b2cbf", "#c77dff"], ["#2ec4b6", "#011627"], ["#3a0ca3", "#4cc9f0"],
  ["#fb8500", "#023047"], ["#ffd60a", "#003566"], ["#90e0ef", "#0077b6"],
  ["#ef233c", "#2b2d42"], ["#70e000", "#004b23"], ["#f72585", "#4361ee"]
];

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function titleLines(title) {
  const words = title.split(/\s+/);
  if (title.length <= 14 || words.length === 1) return [title];
  const pivot = Math.ceil(words.length / 2);
  return [words.slice(0, pivot).join(" "), words.slice(pivot).join(" ")];
}

const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "room310-covers-"));
try {
  for (const [index, game] of manifest.games.entries()) {
    if (extname(game.cover).toLowerCase() !== ".png") throw new Error(`${game.title} must use a PNG placeholder cover.`);
    const destination = resolve(assetsDirectory, game.cover);
    await mkdir(dirname(destination), { recursive: true });
    const svgPath = resolve(temporaryDirectory, `${game.slug}.svg`);
    const [start, end] = colors[index % colors.length];
    const lines = titleLines(game.title);
    const title = lines.map((line, lineIndex) => `<text x="76" y="${lines.length === 1 ? 410 : 365 + lineIndex * 100}" fill="#fff" font-family="Arial Black,Arial,sans-serif" font-size="${lines.length === 1 ? 94 : 78}" font-weight="900">${escapeXml(line)}</text>`).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${start}"/><stop offset="1" stop-color="${end}"/></linearGradient><filter id="s"><feDropShadow dx="0" dy="12" stdDeviation="16" flood-opacity=".3"/></filter></defs>
<rect width="1280" height="720" fill="#0a0a0f"/><rect x="28" y="28" width="1224" height="664" rx="44" fill="url(#g)" filter="url(#s)"/>
<circle cx="1100" cy="148" r="206" fill="#fff" opacity=".09"/><circle cx="1130" cy="600" r="300" fill="#000" opacity=".10"/>
<text x="76" y="125" fill="#fff" opacity=".9" font-family="Arial,sans-serif" font-size="32" font-weight="700" letter-spacing="7">ROOM310</text>
<text x="1190" y="625" fill="#fff" opacity=".18" text-anchor="end" font-family="Arial Black,Arial,sans-serif" font-size="250" font-weight="900">${String(index + 1).padStart(2, "0")}</text>
${title}<rect x="76" y="552" width="184" height="58" rx="29" fill="#0a0a0f" opacity=".72"/><text x="168" y="591" fill="#fff" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" font-weight="700">PLAY GAME</text>
</svg>`;
    await writeFile(svgPath, svg, "utf8");
    await run("/usr/bin/sips", ["-s", "format", "png", svgPath, "--out", destination]);
    process.stdout.write(`Created ${basename(destination)}\n`);
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
