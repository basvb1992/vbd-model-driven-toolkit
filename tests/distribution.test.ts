import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import lock from "../package-lock.json" with { type: "json" };
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("registry-neutral dependency lock", () => {
  it("matches the declared dependency ranges", () => {
    expect(lock.packages[""].dependencies).toEqual(manifest.dependencies);
    expect(lock.packages[""].devDependencies).toEqual(manifest.devDependencies);
  });

  it("pins versions and integrity without requiring a machine-specific registry", () => {
    for (const [name, entry] of Object.entries(lock.packages)) {
      if (!name) {
        continue;
      }
      expect("resolved" in entry, name).toBe(false);
      expect(entry.version, name).toBeTruthy();
      expect("integrity" in entry && typeof entry.integrity === "string" && entry.integrity.length > 0, name)
        .toBe(true);
    }
  });

  it("ships bundled parser notices and the version-bound upstream license fallback", () => {
    const notices = readFileSync(resolve("dist", "THIRD-PARTY-NOTICES.txt"), "utf8");
    for (const name of ["zod", "fast-xml-parser", "@nodable/entities"]) {
      expect(notices).toContain(name);
    }
    expect(notices).toContain("561468f111a66df52cc0f1934642bb9fdd22a212");
    expect(notices).toContain("Copyright (c) 2026 Nodable");
    expect(notices).toContain("Permission is hereby granted");
  });
});
