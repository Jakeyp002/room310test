import { syncProjectVersion } from "./versioning.mjs";

const version = await syncProjectVersion();
console.log(`Room310 version references synchronized to ${version}.`);
