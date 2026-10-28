import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const bundle = readFileSync(resolve("dist", "vbd.toolkit.js"), "utf8");

describe("browser distribution", () => {
  it("exposes the six implemented functions without Node, Xrm, DOM, or workflow dependencies", () => {
    const result: unknown = runInNewContext(`${bundle}
      JSON.stringify({
        modules: Object.keys(VBD).sort(),
        config: Object.keys(VBD.Config).sort(),
        diagnostics: Object.keys(VBD.Diagnostics).sort(),
        version: VBD.Diagnostics.getVersion(),
        invalid: VBD.Config.validate({}).valid
      });`, { crypto: globalThis.crypto });
    expect(typeof result).toBe("string");
    expect(result).toBe(JSON.stringify({
      modules: ["Config", "Diagnostics"],
      config: ["get", "register", "validate"],
      diagnostics: ["getVersion", "normalizeError", "report"],
      version: "0.1.0", invalid: false
    }));
  });

  it("rejects duplicate initialization rather than replacing an existing namespace", () => {
    const existing = { marker: "preserved" };
    const sandbox = { crypto: globalThis.crypto, VBD: existing };
    expect(() => runInNewContext(bundle, sandbox)).toThrow(/namespace already exists/);
    expect(sandbox.VBD).toBe(existing);
  });

  it("preserves the independent existing lowercase vbd namespace", () => {
    const existing = { legacy: true };
    const sandbox = { crypto: globalThis.crypto, vbd: existing };
    runInNewContext(bundle, sandbox);
    expect(sandbox.vbd).toBe(existing);
  });
});
