import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const manifestPath = resolve(process.argv[2] || "game-imports/100-games-expansion.json");
const reviewPath = resolve(process.argv[3] || "game-imports/100-games-expansion-review.json");
const outputPath = resolve(process.argv[4] || "game-imports/100-games-expansion-approved.json");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const review = JSON.parse(await readFile(reviewPath, "utf8"));
const gamesBySlug = new Map(manifest.games.map((game) => [game.slug, game]));
const approved = new Set(review.approved);
const rejected = new Map();

for (const group of review.rejected) {
  for (const slug of group.slugs) {
    if (rejected.has(slug)) throw new Error(`Review rejects ${slug} more than once.`);
    rejected.set(slug, group.reason);
  }
}

for (const slug of [...approved, ...rejected.keys()]) {
  if (!gamesBySlug.has(slug)) throw new Error(`Review references unknown game: ${slug}`);
}
for (const slug of approved) {
  if (rejected.has(slug)) throw new Error(`Review both approves and rejects ${slug}.`);
}
const unreviewed = manifest.games.filter((game) => !approved.has(game.slug) && !rejected.has(game.slug));
if (unreviewed.length) throw new Error(`Review is incomplete: ${unreviewed.map((game) => game.slug).join(", ")}`);

const games = review.approved.map((slug) => {
  const game = gamesBySlug.get(slug);
  const title = review.titleOverrides[slug] || game.title;
  return { ...game, title, description: `Play ${title} directly in Room310.` };
});

const approvedManifest = {
  ...manifest,
  selection: {
    ...manifest.selection,
    browserReviewed: manifest.games.length,
    approved: games.length,
    rejected: rejected.size,
    reviewedAt: review.reviewedAt,
    method: review.method,
    securityBoundary: review.securityBoundary
  },
  games
};

await writeFile(outputPath, `${JSON.stringify(approvedManifest, null, 2)}\n`, "utf8");
console.log(`Approved ${games.length} games; rejected ${rejected.size}.`);
console.log(`Manifest: ${outputPath}`);
