import { build } from "esbuild";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

await mkdir("dist", { recursive: true });
const results = await Promise.all([
  build({
    entryPoints: ["src/index.ts"],
    outfile: "dist/index.mjs",
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    metafile: true,
    legalComments: "eof"
  }),
  build({
    entryPoints: ["src/browser.ts"],
    outfile: "dist/vbd.toolkit.js",
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    metafile: true,
    legalComments: "eof"
  }),
  build({
    entryPoints: ["tools/cli.ts"],
    outfile: "dist/vbd-toolkit.mjs",
    bundle: true,
    format: "esm",
    platform: "node",
    packages: "external",
    target: "node24",
    metafile: true,
    banner: { js: "#!/usr/bin/env node" },
    legalComments: "eof"
  })
]);
const roots = new Set();
for (const result of results) {
  for (const input of Object.keys(result.metafile.inputs)) {
    const parts = input.split(/[\\/]/);
    const index = parts.lastIndexOf("node_modules");
    if (index < 0) continue;
    const packageName = parts[index + 1];
    if (!packageName) throw new Error("Missing bundled package identity.");
    roots.add(join(...parts.slice(0, index + (packageName.startsWith("@") ? 3 : 2))));
  }
}
const notices = [];
for (const root of [...roots].sort()) {
  const metadata = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const names = (await readdir(root)).filter(name => /^(?:licen[cs]e|notice)(?:[._-].*)?$/i.test(name)).sort();
  notices.push(`${metadata.name} ${metadata.version}`);
  if (names.length === 0) {
    if (metadata.name !== "@nodable/entities" || metadata.version !== "3.1.0" || metadata.license !== "MIT") {
      throw new Error(`Missing license notice for bundled dependency ${metadata.name} ${metadata.version}.`);
    }
    notices.push(await readFile("third-party/licenses/nodable-entities-3.1.0.txt", "utf8"));
  }
  for (const name of names) notices.push(await readFile(join(root, name), "utf8"));
}
await writeFile("dist/THIRD-PARTY-NOTICES.txt", notices.join("\n\n"), "utf8");
