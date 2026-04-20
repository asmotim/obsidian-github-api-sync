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
    if (argv[i] === "--expect-version") {
      args.expectVersion = argv[i + 1] ?? null;
      i += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const required = ["dist/main.js", "dist/manifest.json", "manifest.json", "versions.json"];
if (existsSync("styles.css")) {
  required.push("dist/styles.css");
}

const missing = required.filter((path) => !existsSync(path));
if (missing.length > 0) {
  throw new Error(`Missing release assets: ${missing.join(", ")}`);
}

/** @type {{ version: string }} */
const rootManifest = JSON.parse(await readFile("manifest.json", "utf8"));
/** @type {{ version: string }} */
const distManifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));

if (rootManifest.version !== distManifest.version) {
  throw new Error(
    `dist/manifest.json version ${distManifest.version} does not match root manifest version ${rootManifest.version}`,
  );
}

if (args.expectVersion && rootManifest.version !== args.expectVersion) {
  throw new Error(`Expected release version ${args.expectVersion}, but manifest.json has ${rootManifest.version}`);
}

console.log("Release assets OK");
