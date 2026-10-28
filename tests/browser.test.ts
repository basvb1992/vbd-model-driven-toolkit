import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext, runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { configuration } from "./helpers.js";
import { appId, launchFixture } from "./environment-helpers.js";

const bundle = readFileSync(resolve("dist", "vbd.toolkit.js"), "utf8");

describe("browser distribution", () => {
  it("loads the implemented namespace without requiring Node, Xrm, or DOM at initialization", () => {
    const result: unknown = runInNewContext(`${bundle}
      JSON.stringify({
        modules: Object.keys(VBD).sort(),
        config: Object.keys(VBD.Config).sort(),
        diagnostics: Object.keys(VBD.Diagnostics).sort(),
        environment: Object.keys(VBD.Environment).sort(),
        launch: Object.keys(VBD.Launch).sort(),
        links: Object.keys(VBD.Links).sort(),
        windows: Object.keys(VBD.Windows).sort(),
        version: VBD.Diagnostics.getVersion(),
        invalid: VBD.Config.validate({}).valid
      });`, { crypto: globalThis.crypto });
    expect(typeof result).toBe("string");
    expect(result).toBe(JSON.stringify({
      modules: ["Config", "Diagnostics", "Environment", "Launch", "Links", "Windows"],
      config: ["get", "register", "validate"],
      diagnostics: ["getVersion", "normalizeError", "report"],
      environment: ["get", "getBoolean", "getDefinition", "getJson", "getMany", "getNumber", "getOptional", "getText", "invalidate", "preload"],
      launch: ["getProfile", "openPrepared", "prepareProfile"],
      links: ["app"],
      windows: ["open"],
      version: manifest.version, invalid: false
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

  it("integrates the bundled default Xrm adapter, prepared profile and isolated browser request", async () => {
    const source = launchFixture();
    const opened: unknown[][] = [];
    const sandbox = {
      crypto: globalThis.crypto, URL, configuration: configuration(),
      Xrm: {
        Utility: { getGlobalContext: () => ({
          getClientUrl: () => source.scope.environmentUrl,
          userSettings: { userId: source.scope.userId, languageId: source.scope.languageId },
          client: { getClientState: () => "Online" }
        }) },
        WebApi: { retrieveMultipleRecords: source.retrieve }
      },
      navigator: { userActivation: { isActive: true } },
      getPreparedToken: () => preparedToken,
      open: (...args: unknown[]) => { opened.push(args); return null; }
    };
    const context = createContext(sandbox);
    const preparation: unknown = runInContext(`${bundle}
      VBD.Config.register("vm", configuration);
      VBD.Launch.prepareProfile({
        configurationName: "vm", profileKey: "customerWorkspace"
      });`, context);
    const preparedToken: unknown = await preparation;
    const result: unknown = runInContext("VBD.Launch.openPrepared(getPreparedToken());", context);
    expect(result).toEqual({ status: "requested", outcome: "unknown", isolation: "noopener,noreferrer" });
    expect(opened).toEqual([[`https://target.example/main.aspx?appid=${appId}`, "_blank", "noopener,noreferrer"]]);
    expect(source.retrieve).toHaveBeenCalledTimes(6);
  });
});
