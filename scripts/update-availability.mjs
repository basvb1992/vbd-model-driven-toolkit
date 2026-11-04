import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as library from "../dist/index.mjs";

const documented = new Set();
for (const name of await readdir(join("docs", "catalog"))) {
  if (!name.endsWith(".md")) continue;
  const text = await readFile(join("docs", "catalog", name), "utf8");
  for (const match of text.matchAll(/^\| `(VBD\.[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*)` \|/gm)) {
    documented.add(match[1]);
  }
}
const implemented = Object.entries(library)
  .filter(([, value]) => typeof value === "object" && value !== null)
  .flatMap(([namespace, value]) => Object.entries(value).map(([name, method]) => {
    const key = `VBD.${namespace}.${name}`;
    if (typeof method !== "function" || !documented.has(key)) {
      throw new Error(`Public method must be specified before implementation: ${key}`);
    }
    return key;
  })).sort();
const path = join("docs", "function-catalog.md");
const text = await readFile(path, "utf8");
const start = text.indexOf("## Implemented source subset");
const end = text.indexOf("## Reading the catalog", start);
if (start < 0 || end < 0) throw new Error("Missing authoritative availability section.");
const section = [
  "## Implemented source subset", "",
  ...implemented.map(name => `- \`${name}\``), "",
  "Generated from the built exports with `npm run docs:availability`.",
  "Implementation means the documented source subset, not live tenant or deployment certification.",
  "See [core usage](core-usage.md), [getting started](getting-started.md), and",
  "[environment/app runtime usage](environment-launching.md) for exact contracts and limits.", "", ""
].join("\n");
const updated = text.slice(0, start).replace(
  /\*\*[^\r\n]*functions have a local implementation; the other \d+ remain planned\.\*\*/,
  `**${implemented.length} functions have a local implementation; the other ${documented.size - implemented.length} remain planned.**`
) + section + text.slice(end);
await writeFile(path, updated, "utf8");
console.log(`Availability: ${implemented.length}/${documented.size} specified functions.`);
