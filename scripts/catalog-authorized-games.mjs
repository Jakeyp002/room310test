import { inflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const runningDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
const launcherPath = resolve(runningDirectly
  ? (process.argv[2] || process.env.ROOM310_AUTHORIZED_GAMES_LAUNCHER || "single-file.html")
  : (process.env.ROOM310_AUTHORIZED_GAMES_LAUNCHER || "single-file.html"));
const launcher = await readFile(launcherPath, "utf8");
const encodedPackages = launcher.match(/var c2 = r\("([0-9a-f]+)"\)/)?.[1];
if (!encodedPackages) throw new Error("The authorized launcher package list could not be found.");
const packages = JSON.parse(Buffer.from(encodedPackages, "hex").toString("utf8"));

function packageUrl(packageName, filename) {
  return `https://cdn.jsdelivr.net/npm/${packageName}/${filename}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRange(url, start, end) {
  const response = await fetchWithTimeout(url, { headers: { Range: `bytes=${start}-${end}` } }, 30_000);
  if (![200, 206].includes(response.status)) throw new Error(`Range request failed with ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (response.status === 200) return bytes.subarray(start, end + 1);
  return bytes;
}

async function catalogPackage(packageName, filename, packageIndex) {
  const url = packageUrl(packageName, filename);
  const head = await fetchWithTimeout(url, { method: "HEAD" });
  if (!head.ok) throw new Error(`HEAD failed with ${head.status}`);
  const byteLength = Number(head.headers.get("content-length"));
  if (!Number.isSafeInteger(byteLength) || byteLength < 22) throw new Error("ZIP size was unavailable");
  const tailStart = Math.max(0, byteLength - 131_072);
  const tail = await fetchRange(url, tailStart, byteLength - 1);
  let eocd = -1;
  for (let index = tail.length - 22; index >= 0; index -= 1) {
    if (tail.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
  }
  if (eocd < 0) throw new Error("ZIP directory was not found");
  const entryCount = tail.readUInt16LE(eocd + 10);
  const centralSize = tail.readUInt32LE(eocd + 12);
  const centralOffset = tail.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new Error("ZIP64 packages are not supported");
  const central = await fetchRange(url, centralOffset, centralOffset + centralSize - 1);
  const entries = [];
  let cursor = 0;
  while (cursor < central.length) {
    if (central.readUInt32LE(cursor) !== 0x02014b50) throw new Error("ZIP directory entry was invalid");
    const flags = central.readUInt16LE(cursor + 8);
    const compression = central.readUInt16LE(cursor + 10);
    const compressedBytes = central.readUInt32LE(cursor + 20);
    const bytes = central.readUInt32LE(cursor + 24);
    const nameLength = central.readUInt16LE(cursor + 28);
    const extraLength = central.readUInt16LE(cursor + 30);
    const commentLength = central.readUInt16LE(cursor + 32);
    const localOffset = central.readUInt32LE(cursor + 42);
    const name = central.subarray(cursor + 46, cursor + 46 + nameLength).toString(flags & 0x800 ? "utf8" : "latin1");
    if (/\.html?$/i.test(name) && !name.endsWith("/")) {
      entries.push({ packageIndex, packageName, packageFile: filename, url, name, filename: basename(name), compression, compressedBytes, bytes, localOffset });
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (entries.length !== entryCount && entries.length === 0) throw new Error("ZIP contains no HTML games");
  return entries;
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

export async function catalogAuthorizedGames() {
  const failures = [];
  const groups = await mapConcurrent(packages, 8, async ([packageName, filename], index) => {
    try {
      return await catalogPackage(packageName, filename, index + 1);
    } catch (error) {
      failures.push({ packageIndex: index + 1, packageName, filename, error: error.message });
      return [];
    }
  });
  return { launcher: { filename: basename(launcherPath), sha256: createHash("sha256").update(launcher).digest("hex") }, entries: groups.flat(), failures };
}

export async function extractAuthorizedEntry(entry, destination) {
  const header = await fetchRange(entry.url, entry.localOffset, entry.localOffset + 29);
  if (header.readUInt32LE(0) !== 0x04034b50) throw new Error(`${entry.filename} has an invalid local ZIP header.`);
  const nameLength = header.readUInt16LE(26);
  const extraLength = header.readUInt16LE(28);
  const dataStart = entry.localOffset + 30 + nameLength + extraLength;
  const compressed = await fetchRange(entry.url, dataStart, dataStart + entry.compressedBytes - 1);
  const contents = entry.compression === 0 ? compressed : entry.compression === 8 ? inflateRawSync(compressed) : null;
  if (!contents) throw new Error(`${entry.filename} uses unsupported ZIP compression ${entry.compression}.`);
  if (contents.length !== entry.bytes) throw new Error(`${entry.filename} extracted to an unexpected size.`);
  await mkdir(resolve(destination, ".."), { recursive: true });
  await writeFile(destination, contents);
  return { bytes: contents.length, sha256: createHash("sha256").update(contents).digest("hex") };
}

if (runningDirectly) {
  const catalog = await catalogAuthorizedGames();
  if (process.argv.includes("--json")) console.log(JSON.stringify(catalog, null, 2));
  else {
    console.log("package\tentry\tbytes\tcompressed_bytes");
    for (const entry of catalog.entries) console.log(`${entry.packageIndex}\t${entry.filename}\t${entry.bytes}\t${entry.compressedBytes}`);
    for (const failure of catalog.failures) console.error(`Skipped package ${failure.packageIndex}: ${failure.error}`);
  }
}
