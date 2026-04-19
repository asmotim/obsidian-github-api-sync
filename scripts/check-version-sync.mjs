// @ts-check

import { readFile } from "fs/promises";
import { existsSync } from "fs";

/**
 * @param {string[]} argv
 * @returns {{ expectVersion: string | null }}
 */
function parseArgs(argv) {
  /** @type {{ expectVersion: string | null }} */
  const args = { expectVersion: null };
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === "--expect-version") {
      args.expectVersion = argv[i + 1] ?? null;
      i += 1;
    }
  }
  return args;
}

/**
 * @template T
 * @param {string} path
 * @returns {Promise<T>}
 */
async function readJson(path) {
  return /** @type {T} */ (JSON.parse(await readFile(path, "utf8")));
}

const args = parseArgs(process.argv.slice(2));
const manifest = await readJson(
  "manifest.json"
);
const pkg = await readJson(
  "package.json"
);
const lock = existsSync("package-lock.json") ? await readJson("package-lock.json") : null;
const versions = existsSync("versions.json") ? await readJson("versions.json") : null;

const expected = args.expectVersion;
const versionsSeen = new Map([
  ["manifest.json", manifest.version],
  ["package.json", pkg.version],
]);

if (lock) {
  if (lock.version) versionsSeen.set("package-lock.json", lock.version);
  if (lock.packages?.[""]?.version) versionsSeen.set("package-lock.json packages['']", lock.packages[""].version);
}

const uniqueVersions = new Set(versionsSeen.values());
if (uniqueVersions.size !== 1) {
  const details = [...versionsSeen.entries()].map(([k, v]) => `${k}=${v}`).join(", ");
  throw new Error(`Version drift detected: ${details}`);
}

if (expected && manifest.version !== expected) {
  throw new Error(`Expected version ${expected}, but manifest.json has ${manifest.version}`);
}

if (versions) {
  const mappedMinAppVersion = versions[manifest.version];
  if (mappedMinAppVersion && mappedMinAppVersion !== manifest.minAppVersion) {
    throw new Error(
      `versions.json maps ${manifest.version} to ${mappedMinAppVersion}, expected ${manifest.minAppVersion}`,
    );
  }
}

console.log(`Version sync OK: ${manifest.version}`);
