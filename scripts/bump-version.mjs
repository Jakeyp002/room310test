import { classifyUpdate, nextVersion, writePackageVersion } from "./versioning.mjs";
import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const requested = args[0] || "auto";
const summary = requested === "auto" ? args.slice(1).join(" ") : args.slice(1).join(" ");
const significance = requested === "auto" ? classifyUpdate(summary) : requested;

if (requested === "release") {
  if (!args.includes("--confirm-1.0")) {
    throw new Error("Room310 is locked below 1.0.0. The owner must explicitly authorize 1.0.0, then use release --confirm-1.0.");
  }
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  if (!packageJson.version.startsWith("0.")) throw new Error("The 1.0.0 release command is only for a pre-1.0 Room310 version.");
  await writePackageVersion("1.0.0");
  console.log(`Room310 ${packageJson.version} -> 1.0.0 (owner-approved stable release)`);
  process.exit(0);
}
if (significance === "major" || requested === "1.0.0") {
  throw new Error("Room310 is locked below 1.0.0. Use the owner-approved release command only after the user explicitly authorizes 1.0.0.");
}
if (!new Set(["patch", "minor"]).has(significance)) {
  throw new Error("Use auto, patch, or minor. Version 1.0.0 is intentionally locked.");
}

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const next = nextVersion(packageJson.version, significance);
await writePackageVersion(next);
console.log(`Room310 ${packageJson.version} -> ${next} (${significance})`);
