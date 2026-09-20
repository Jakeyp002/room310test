import { readFile, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { scanStandaloneHtml } from "../client-src/standalone-game.js";

const outputDirectory = resolve(process.argv[2] || "/tmp/room310-authorized-game-expansion");
const targetCount = Math.max(1, Math.min(150, Number(process.argv[3] || 125)));
process.env.ROOM310_AUTHORIZED_GAMES_LAUNCHER = resolve(process.argv[4] || process.env.ROOM310_AUTHORIZED_GAMES_LAUNCHER || "single-file.html");
const { catalogAuthorizedGames, extractAuthorizedEntry } = await import("./catalog-authorized-games.mjs");
const manifestPath = resolve("game-imports/100-games-expansion.json");
const existingFiles = new Set([
  "2048.html", "retrobowl.html", "ovo2.html", "paperio2.htm", "soccerrandom.htm", "stack.html", "stickmanhook.html", "vex7.htm",
  "slope.html", "holeio.html", "tombofthemask.htm", "snowrider.htm", "getawayshootout.htm", "monkeymart.htm", "tunnelrush.html"
]);
const nameExclusions = /multiplayer|2player|1on1|(?:^|[^a-z])io(?:\.|$)|bros|football|soccer|basketball|volley|tennis|pingpong|rooftopsnipers|tubejumpers|fireboyandwatergirl|badicecream|stickarchers|stickfighter|ragdollarchers|ragdollsoccer|houseofhazards|12minibattles|getontop|wrestle|amongus|ducklings|territorial|blockysnakes|agariolite|cleanupio|snowballio|templeofboom|funnybattle|1v1|karate|baseball/i;
const opaqueOriginBreakers = new Set([
  "Service worker registration", "Cookie access", "External script"
]);
const wordBreaks = [
  "adventure", "american", "angry", "awesome", "bacon", "bakeria", "become", "biker", "bird", "birds", "bit",
  "bloxorz", "blumgi", "bob", "boss", "breakout", "breaking", "bubble", "candy", "capybara", "car", "cars", "chase",
  "cheeseria", "chess", "choppy", "circle", "circlo", "clicker", "climber", "college", "cookie", "crossy", "cupcakes",
  "dadish", "dash", "death", "devil", "dino", "doodle", "draw", "drift", "drive", "duck", "eggy", "elastic", "escape",
  "evil", "face", "fancy", "fishing", "flappy", "flood", "fly", "free", "freezeria", "fruit", "geometry", "glitch",
  "google", "hanger", "happy", "hardest", "helix", "highway", "hill", "hook", "idle", "impossible", "iron", "jetpack",
  "johnny", "joyride", "jump", "jumping", "learn", "level", "life", "mad", "mart", "merge", "merger", "mine", "miner",
  "minesweeper", "monster", "moto", "noob", "only", "opposite", "ovo", "pacman", "pancakeria", "papa", "papas", "parking",
  "pants", "pizza", "pizzeria", "plonky", "poly", "poor", "pou", "racing", "racers", "red", "retro", "riddle", "rider",
  "road", "robber", "rocket", "run", "runner", "sand", "school", "shell", "short", "slow", "space", "speed", "sprunki",
  "state", "still", "stick", "super", "taco", "tacomia", "temple", "the", "this", "tiny", "tracks", "transfer", "trap",
  "trivia", "unicycle", "unlimited", "vex", "war", "waves", "we", "wheely", "what", "wheelie", "world", "zombie"
].sort((a, b) => b.length - a.length);

function slugify(filename) {
  const base = basename(filename).replace(/\.html?$/i, "").toLowerCase();
  const separated = base.replace(/([a-z])([0-9])/g, "$1-$2").replace(/([0-9])([a-z])/g, "$1-$2");
  return separated.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
}

function splitWords(source) {
  const memo = new Map();
  const visit = (remaining) => {
    if (!remaining) return [];
    if (memo.has(remaining)) return memo.get(remaining);
    let best = null;
    for (const word of wordBreaks) {
      if (!remaining.startsWith(word)) continue;
      const rest = visit(remaining.slice(word.length));
      if (rest && (!best || rest.length + 1 < best.length)) best = [word, ...rest];
    }
    memo.set(remaining, best);
    return best;
  };
  return visit(source) || [source];
}

function titleFor(filename) {
  const base = basename(filename).replace(/\.html?$/i, "");
  const special = new Map([
    ["bloonstd", "Bloons TD"], ["bloonstd2", "Bloons TD 2"], ["bloonstd3", "Bloons TD 3"], ["bloonstd4", "Bloons TD 4"],
    ["motox3m", "Moto X3M"], ["motox3m2", "Moto X3M 2"], ["motox3m3", "Moto X3M 3"], ["motox3mpoolparty", "Moto X3M Pool Party"],
    ["motox3mspookyland", "Moto X3M Spooky Land"], ["motox3mwinter", "Moto X3M Winter"], ["sm64", "Super Mario 64"],
    ["deathrun3d", "Death Run 3D"], ["2048cupcakes", "2048 Cupcakes"], ["8ballclassic", "8 Ball Classic"],
    ["circloo", "CircloO"], ["circloo2", "CircloO 2"], ["vexx3m", "Vex X3M"], ["vexx3m2", "Vex X3M 2"]
  ]);
  const normalized = base.toLowerCase();
  if (special.has(normalized)) return special.get(normalized);
  const pieces = normalized.split(/[_-]+|(?<=\D)(?=\d)|(?<=\d)(?=\D)/).flatMap((piece) => /^\d+$/.test(piece) ? piece : splitWords(piece));
  return pieces.map((piece) => /^\d+$/.test(piece) ? piece : piece.charAt(0).toUpperCase() + piece.slice(1)).join(" ");
}

async function mapConcurrent(values, concurrency, callback) {
  const results = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await callback(values[index], index);
    }
  }));
  return results;
}

await rm(outputDirectory, { recursive: true, force: true });
const catalog = await catalogAuthorizedGames();
const candidates = catalog.entries
  .map((entry) => ({ ...entry, slug: slugify(entry.filename) }))
  .filter((entry) => entry.bytes <= 18 * 1024 * 1024 && !existingFiles.has(entry.filename.toLowerCase()) && !nameExclusions.test(entry.filename))
  .sort((a, b) => a.bytes - b.bytes || a.packageIndex - b.packageIndex)
  .slice(0, targetCount);

const reviewed = await mapConcurrent(candidates, 10, async (entry) => {
  const source = `html/${entry.slug}.html`;
  try {
    const extracted = await extractAuthorizedEntry(entry, resolve(outputDirectory, source));
    const html = await readFile(resolve(outputDirectory, source), "utf8");
    const findings = scanStandaloneHtml(html);
    const blockers = findings.filter((finding) => opaqueOriginBreakers.has(finding));
    if (blockers.length) {
      await rm(resolve(outputDirectory, source), { force: true });
      return { status: "skipped", filename: entry.filename, packageIndex: entry.packageIndex, reason: `security/compatibility scan: ${blockers.join(", ")}`, findings };
    }
    const title = titleFor(entry.filename);
    return {
      status: "prepared",
      filename: entry.filename,
      game: {
        title,
        slug: entry.slug,
        description: `Play ${title} directly in Room310.`,
        year: 2026,
        source,
        cover: `covers/${entry.slug}.png`,
        sourceBytes: extracted.bytes,
        sourceSha256: extracted.sha256,
        sourcePackage: `${entry.packageName}@1.0.0/${entry.packageFile}`,
        sourceEntry: entry.name,
        reviewFindings: findings
      }
    };
  } catch (error) {
    return { status: "skipped", filename: entry.filename, packageIndex: entry.packageIndex, reason: error.message, findings: [] };
  }
});

const prepared = reviewed.filter((item) => item.status === "prepared").map((item) => item.game);
const skipped = reviewed.filter((item) => item.status === "skipped");
const manifest = {
  collection: { title: "100+ Games", slug: "100-games", description: "A searchable collection of browser games hosted directly for Room310." },
  permission: { sourceOwner: "Shea O'Neil", note: "I am Shea O'Neil. I authorize Room310 to download and use my game files.", suppliedInConversation: true },
  sourceManifest: catalog.launcher,
  selection: { requestedCandidates: targetCount, prepared: prepared.length, skipped: skipped.length, rules: "Single-player leaning, <=18 MiB, no obvious multiplayer/online titles, fail-fast range extraction, opaque-origin blocker scan." },
  games: prepared
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await writeFile(resolve(outputDirectory, "review-report.json"), `${JSON.stringify({ prepared: prepared.map((game) => game.slug), skipped, catalogFailures: catalog.failures }, null, 2)}\n`, "utf8");
console.log(`Prepared ${prepared.length} games; skipped ${skipped.length}; catalog failures ${catalog.failures.length}.`);
console.log(`Manifest: ${manifestPath}`);
console.log(`Assets: ${outputDirectory}`);
