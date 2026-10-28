import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import lock from "../package-lock.json" with { type: "json" };

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
});
