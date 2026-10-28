import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";

await mkdir("dist", { recursive: true });
await Promise.all([
  build({
    entryPoints: ["src/index.ts"],
    outfile: "dist/index.mjs",
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    legalComments: "eof"
  }),
  build({
    entryPoints: ["src/browser.ts"],
    outfile: "dist/vbd.toolkit.js",
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
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
    banner: { js: "#!/usr/bin/env node" },
    legalComments: "eof"
  })
]);
const license = await readFile("node_modules/zod/LICENSE", "utf8");
await writeFile("dist/THIRD-PARTY-NOTICES.txt", `Zod\n\n${license}`, "utf8");
