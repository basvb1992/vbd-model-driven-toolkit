import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { browserBuildOptions, collectBundleNotices } from "./bundle-contract.mjs";

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
  build({ ...browserBuildOptions }),
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
const notices = await collectBundleNotices(process.cwd(), results.flatMap(result => Object.keys(result.metafile.inputs)));
await writeFile("dist/THIRD-PARTY-NOTICES.txt", notices.text, "utf8");
