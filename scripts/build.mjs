import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const projectUrl = process.env.SUPABASE_URL || "https://khbmuaitysznyxxefhou.supabase.co";
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || "";

if (process.env.NETLIFY === "true" && !publishableKey) {
  throw new Error("SUPABASE_PUBLISHABLE_KEY must be configured in Netlify before deploying Room310 v1.2.");
}

await rm("dist", { force: true, recursive: true });
await mkdir("dist", { recursive: true });
// Retain the generated bundle for the original local Python server as well.
await build({
  entryPoints: ["client-src/code-tools.js"],
  bundle: true,
  format: "iife",
  minify: true,
  outfile: "room310files/code-tools.js",
  target: ["es2022"],
  legalComments: "eof"
});
await cp("room310files", "dist", { recursive: true });

await writeFile(
  "dist/supabase-config.js",
  `window.ROOM310_SUPABASE_CONFIG = ${JSON.stringify({ projectUrl, publishableKey })};\n`,
  "utf8"
);

await build({
  entryPoints: {
    "admin-login": "client-src/admin-login.js",
    "admin-games": "client-src/admin-games.js",
    games: "client-src/games.js",
    graphs: "client-src/graphs.js",
    graph: "client-src/graph.js",
    "admin-graphs": "client-src/admin-graphs.js"
  },
  bundle: true,
  format: "iife",
  minify: true,
  outdir: "dist",
  sourcemap: false,
  target: ["es2022"]
});

if (!publishableKey) {
  console.warn("SUPABASE_PUBLISHABLE_KEY is not set; the static site will build, but Supabase features will show a configuration message.");
}
