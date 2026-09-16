import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseVersion(value) {
  const match = semverPattern.exec(value);
  if (!match) throw new TypeError(`Invalid 0.0.0 version: ${value}`);
  return match.slice(1).map(Number);
}

export function classifyUpdate(summary = "") {
  const text = summary.trim().toLowerCase();
  if (!text) return "patch";
  if (/\b(breaking|overhaul|redesign|replace|remove|new (?:feature|course|system)|add(?:ed|ing|s)?|introduce|integration|expand)\b/.test(text)) return "minor";
  return "patch";
}

export function nextVersion(current, significance) {
  const [major, minor, patch] = parseVersion(current);
  if (significance === "patch") return `${major}.${minor}.${patch + 1}`;
  if (significance === "minor") {
    if (major === 0 && minor === 99) throw new Error("The pre-1.0 version ceiling has been reached; an explicit 1.0.0 release is required.");
    return `${major}.${minor + 1}.0`;
  }
  throw new TypeError(`Unknown update significance: ${significance}`);
}

export function synchronizeHtmlVersion(source, version) {
  parseVersion(version);
  return source
    .replace(/([?&]v=)\d+\.\d+(?:\.\d+)?/g, `$1${version}`)
    .replace(/(<[^>]*\bdata-room310-version(?:\s[^>]*)?>)v\d+\.\d+\.\d+(?=<)/g, `$1v${version}`)
    .replace(/(<[^>]*\bdata-room310-version-prefix="([^"]*)"[^>]*>)[^<]*(?=<)/g, (_match, opening, prefix) => `${opening}${prefix}v${version}`);
}

export async function syncProjectVersion(versionOverride) {
  const packagePath = resolve(root, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  const version = versionOverride || packageJson.version;
  parseVersion(version);

  const sourceDir = resolve(root, "room310files");
  const names = await readdir(sourceDir);
  const htmlNames = names.filter((name) => name.endsWith(".html"));
  await Promise.all(htmlNames.map(async (name) => {
    const path = resolve(sourceDir, name);
    const before = await readFile(path, "utf8");
    const after = synchronizeHtmlVersion(before, version);
    if (after !== before) await writeFile(path, after, "utf8");
  }));
  return version;
}

export async function writePackageVersion(version) {
  parseVersion(version);
  for (const name of ["package.json", "package-lock.json"]) {
    const path = resolve(root, name);
    const data = JSON.parse(await readFile(path, "utf8"));
    data.version = version;
    if (name === "package-lock.json" && data.packages?.[""]) data.packages[""].version = version;
    await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }
  await syncProjectVersion(version);
}
