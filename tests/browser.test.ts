import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext, runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { configuration } from "./helpers.js";
import { appId, launchFixture } from "./environment-helpers.js";
import * as library from "../src/index.js";

const bundle = readFileSync(resolve("dist", "vbd.toolkit.js"), "utf8");

describe("browser distribution", () => {
  it("builds deep links and reports absent capabilities in the browser bundle without invoking a host", () => {
    const result: unknown = runInNewContext(`${bundle}
      JSON.stringify({
        url: VBD.Links.view({
          environmentUrl: "https://target.example", allowedOrigins: ["https://target.example"],
          appName: "vbd_App", entityName: "account", viewId: "${appId}", viewType: "userquery"
        }),
        capabilities: VBD.Diagnostics.getCapabilities(),
        sidePaneMethods: Object.keys(VBD.SidePanes).sort()
      });`, { crypto: globalThis.crypto, URL }, { timeout: 5000 });
    expect(result).toBe(JSON.stringify({
      url: `https://target.example/main.aspx?appname=vbd_App&pagetype=entitylist&etn=account&viewid=%7B${appId}%7D&viewtype=4230`,
      capabilities: {
        toolkitVersion: manifest.version, basis: "methodPresenceOnly",
        capabilities: {
          navigation: "absent", quickCreate: "absent", lookups: "absent",
          environmentReads: "absent", sidePanes: "absent", notifications: "absent"
        }
      },
      sidePaneMethods: ["close", "createOrGet", "navigate", "select"]
    }));
  });
  it("loads the implemented namespace without requiring Node, Xrm, or DOM at initialization", () => {
    const result: unknown = runInNewContext(`${bundle}
      JSON.stringify({
        methods: Object.fromEntries(Object.entries(VBD).sort(([a],[b]) => a.localeCompare(b))
          .map(([name,value]) => [name,Object.keys(value).sort()])),
        version: VBD.Diagnostics.getVersion(),
        invalid: VBD.Config.validate({}).valid
      });`, { crypto: globalThis.crypto });
    expect(typeof result).toBe("string");
    const methods = Object.fromEntries(Object.entries(library)
      .filter(([, value]) => typeof value === "object" && value !== null)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => [name, Object.keys(value).sort()]));
    expect(result).toBe(JSON.stringify({
      methods,
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
