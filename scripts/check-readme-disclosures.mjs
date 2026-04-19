// @ts-check

import { readFile } from "fs/promises";

const readme = (await readFile("README.md", "utf8")).toLowerCase();

const requiredPhrases = [
  "## status",
  "## security and privacy disclosures",
  "network access",
  "account requirement",
  "data leaves your device",
  "secrets",
  "telemetry",
  "mobile support",
  "## token permissions",
  "## development",
  "## release process",
  "## support",
];

const missing = requiredPhrases.filter((phrase) => !readme.includes(phrase));
if (missing.length > 0) {
  throw new Error(`README is missing required disclosure content: ${missing.join(", ")}`);
}

console.log("README disclosures OK");
