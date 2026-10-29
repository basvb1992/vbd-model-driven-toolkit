import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as library from "../src/index.js";

function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? markdownFiles(path) : entry.name.endsWith(".md") ? [path] : [];
  });
}

const documents = [
  resolve("README.md"), resolve("CONTRIBUTING.md"), ...markdownFiles(resolve("docs"))
];
const catalogFiles = markdownFiles(resolve("docs", "catalog"));
const api = /VBD\.[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*/g;
const catalogNames = catalogFiles.flatMap((file) => [
  ...readFileSync(file, "utf8").matchAll(/^\| `(VBD\.[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*)` \|/gm)
].map((match) => match[1]));

describe("documentation contracts", () => {
  it("keeps all 198 API candidates unique across 41 namespaces", () => {
    expect(catalogNames).toHaveLength(198);
    expect(new Set(catalogNames).size).toBe(198);
    expect(new Set(catalogNames.map((name) => name?.slice(0, name.lastIndexOf(".")))).size).toBe(41);
  });

  it("documents inputs, returns, constraints, and phase for every candidate", () => {
    for (const file of catalogFiles) {
      for (const line of readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.startsWith("| `VBD."))) {
        const cells = line.slice(1, -1).split("|").map((value) => value.trim());
        expect(cells).toHaveLength(5);
        expect(cells.every(Boolean)).toBe(true);
        expect(cells[4]).toMatch(/^R[123]$/);
      }
    }
  });

  it("keeps the implemented list aligned with the actual public methods", () => {
    const index = readFileSync(resolve("docs", "function-catalog.md"), "utf8");
    const section = index.split("## Implemented source subset")[1]?.split("## Reading the catalog")[0] ?? "";
    const documented = [...section.matchAll(/^- `(VBD\.[A-Za-z]+\.[A-Za-z]+)`/gm)]
      .map((match) => match[1]).sort();
    const actual = Object.entries(library).filter(([, value]) => typeof value === "object" && value !== null)
      .flatMap(([module, methods]) => Object.keys(methods).map((name) => `VBD.${module}.${name}`)).sort();
    expect(documented).toEqual(actual);
    expect(actual).toHaveLength(145);
  });

  it("has no broken local document/example links or undocumented function references", () => {
    for (const file of documents) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/(?<!!)\[[^\]]+\]\(([^)]+)\)/g)) {
        const link = match[1];
        if (!link || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(link) || link.startsWith("#")) {
          continue;
        }
        const destination = link.split("#")[0];
        if (destination) {
          expect(existsSync(resolve(dirname(file), destination)), `${file}: ${link}`).toBe(true);
        }
      }
      for (const name of text.match(api) ?? []) {
        expect(catalogNames, `${file}: ${name}`).toContain(name);
      }
    }
  });
});
