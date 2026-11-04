import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";

await mkdir("dist/playground", { recursive: true });
const result = await build({
  entryPoints: ["playground/main.ts"], outfile: "dist/playground/vbd.playground.js",
  bundle: true, format: "iife", platform: "browser", target: "es2022",
  metafile: true, legalComments: "eof"
});
if (Object.keys(result.metafile.inputs).some(path => !path.startsWith("playground/")) ||
    Object.values(result.metafile.outputs).some(output => output.imports.length !== 0)) {
  throw new Error("The Playground must reference the separately installed Core, not bundle libraries or external imports.");
}
await copyFile("playground/index.html", "dist/playground/vbd.playground.html");
await copyFile("playground/icon.svg", "dist/playground/vbd.playground.svg");
