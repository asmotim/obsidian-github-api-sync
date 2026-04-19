// @ts-check

import { build, context } from "esbuild";
import { mkdir, copyFile, access } from "fs/promises";
import { resolve } from "path";

const args = new Set(process.argv.slice(2));
const watch = args.has("--watch");

const outdir = resolve("dist");
await mkdir(outdir, { recursive: true });

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: resolve(outdir, "main.js"),
  format: "cjs",
  platform: "browser",
  sourcemap: true,
  target: "es2018",
  external: [
    "obsidian",
    "electron",
    "crypto",
    "@codemirror/*",
    "@lezer/*",
  ],
  logLevel: "info",
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await build(options);
}

await copyFile("manifest.json", resolve(outdir, "manifest.json"));

try {
  await access("styles.css");
  await copyFile("styles.css", resolve(outdir, "styles.css"));
} catch {
  // No styles.css
}
