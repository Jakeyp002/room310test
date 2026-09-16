import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PREPARATIONS = [
  {
    slug: "ovo-2",
    originalSha256: "c0aac30d6d39facb88621a1c8efe4bcbac3462ecdb92646ad7aba43f12ac1ab0",
    preparedSha256: "d9bd08cc071328fe0f5ef1e1c29114371e6cd5df2ed5f13d41e0fd9292bb32e7",
    transform: prepareOvo2
  },
  {
    slug: "stickman-hook",
    originalSha256: "d78c94e52dc71fad6148f63235453d67c08a35a775bbdfd5dffc1d34e5b68d8c",
    preparedSha256: "9034824fb1d0e05b23c2a37613838e32755e7b95634224e955d6f528ab3613e2",
    transform: prepareStickmanHook
  }
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function prepareOvo2(original) {
  const scripts = [...original.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi)];
  if (scripts.length !== 6 || !scripts[5][0].includes('self["C3_CreateRuntime"]=C3.Runtime.Create')) {
    throw new Error("OvO 2 runtime layout changed; refusing to prepare an unknown file.");
  }
  const domBootstrap = scripts[3][0];
  const constructRuntime = scripts[5][0];
  return original.replace(constructRuntime, () => domBootstrap).replace(domBootstrap, () => constructRuntime);
}

export function prepareStickmanHook(original) {
  const oldSiteLock = 'a = window[n[16]][n[15]];\n            if ((a = a[n[19]](n[18])[1][n[6]](n[17], n[1]))';
  const safeSiteLock = 'a = window[n[16]][n[15]];\n            if ((a = (a[n[19]](n[18])[1] || "localhost/")[n[6]](n[17], n[1]))';
  if (!original.includes(oldSiteLock) || !original.includes("<head>")) {
    throw new Error("Stickman Hook compatibility layout changed; refusing to prepare an unknown file.");
  }
  const cookieShim = '<script data-room310-compatibility="opaque-cookie-shim">try{Object.defineProperty(document,"cookie",{configurable:true,get:function(){return ""},set:function(){return true}})}catch(error){}</script>';
  return original.replace("<head>", `<head>${cookieShim}`).replace(oldSiteLock, safeSiteLock);
}

export async function preparePilotCompatibility(assetsDirectory) {
  const root = resolve(assetsDirectory);
  const outputDirectory = resolve(root, "prepared", "html");
  await mkdir(outputDirectory, { recursive: true });
  const results = [];

  for (const preparation of PREPARATIONS) {
    const sourcePath = resolve(root, "html", `${preparation.slug}.html`);
    const original = await readFile(sourcePath, "utf8");
    if (sha256(original) !== preparation.originalSha256) {
      throw new Error(`${preparation.slug} does not match the authorized original SHA-256 hash.`);
    }
    const prepared = preparation.transform(original);
    const preparedHash = sha256(prepared);
    if (preparedHash !== preparation.preparedSha256) {
      throw new Error(`${preparation.slug} did not produce the reviewed compatibility build.`);
    }
    const outputPath = resolve(outputDirectory, `${preparation.slug}.html`);
    await writeFile(outputPath, prepared);
    results.push({ slug: preparation.slug, outputPath, sha256: preparedHash, bytes: Buffer.byteLength(prepared) });
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const assetsDirectory = resolve(process.argv[2] || ".");
  preparePilotCompatibility(assetsDirectory).then((results) => {
    for (const result of results) console.log(`${result.slug}: ${result.bytes} bytes, ${result.sha256}, ${result.outputPath}`);
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
