import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { TextDecoder } from "node:util";

export const NOTICE_HEADER = "VBD Toolkit third-party notices\n\n";
export const browserBuildOptions = Object.freeze({
  entryPoints: Object.freeze(["src/browser.ts"]), outfile: "dist/vbd.toolkit.js",
  bundle: true, format: "iife", platform: "browser", target: "es2022",
  metafile: true, legalComments: "eof"
});

export function packageRootForInput(input) {
  const parts = input.split(/[\\/]/), index = parts.lastIndexOf("node_modules");
  if (index < 0) return undefined;
  const name = parts[index + 1];
  if (!name || (name.startsWith("@") && !parts[index + 2])) {
    throw new Error("Missing bundled package identity.");
  }
  return parts.slice(0, index + (name.startsWith("@") ? 3 : 2)).join("/");
}

export async function collectBundleNotices(root, inputNames, options = {}) {
  const read = options.read ?? (path => readFile(join(root, path)));
  const files = new Map(), packages = [];
  async function remember(path) {
    const bytes = await read(path);
    files.set(path, bytes);
    return bytes;
  }
  async function license(path) {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(await remember(path));
    if (!text.trim()) throw new Error("Empty bundled license notice.");
    return text;
  }
  const roots = [...new Set(inputNames.map(packageRootForInput).filter(Boolean))].sort();
  const sections = [];
  for (const packageRoot of roots) {
    const metadata = JSON.parse(new TextDecoder("utf-8", { fatal: true })
      .decode(await remember(`${packageRoot}/package.json`)));
    if (metadata.name !== packageRoot.split("node_modules/").at(-1) || typeof metadata.version !== "string") {
      throw new Error("Invalid bundled package metadata.");
    }
    packages.push({ name: metadata.name, version: metadata.version, root: packageRoot });
    const names = (await readdir(join(root, packageRoot)))
      .filter(name => /^(?:licen[cs]e|notice)(?:[._-].*)?$/i.test(name)).sort();
    sections.push(`${metadata.name} ${metadata.version}`);
    if (names.length === 0) {
      if (metadata.name !== "@nodable/entities" || metadata.version !== "3.1.0" || metadata.license !== "MIT") {
        throw new Error(`Missing license notice for bundled dependency ${metadata.name} ${metadata.version}.`);
      }
      sections.push(await license("third-party/licenses/nodable-entities-3.1.0.txt"));
    }
    for (const name of names) {
      sections.push(await license(`${packageRoot}/${name}`));
    }
  }
  const body = sections.length ? sections.join("\n\n") : "No third-party packages are bundled by this build.";
  return { text: `${NOTICE_HEADER}${body}\n`, files, packages };
}
