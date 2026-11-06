import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { isRecord } from "../src/validation.js";

async function compiled() {
  const built = await build({
    stdin: {
      contents: 'export { Rules } from "./src/rules.ts"; export { Context } from "./src/context.ts";',
      resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "ts"
    },
    bundle: true, write: false, platform: "browser", target: "es2022",
    format: "iife", globalName: "OwnedRules"
  });
  const bundle = built.outputFiles[0]?.text;
  if (!bundle) throw new Error("Missing in-memory rule fixture build");
  return bundle;
}

describe("compiled native Rules fixture (no tenant calls)", () => {
  it("loads without Xrm, DOM or Node globals; exports exactly the four catalog methods", async () => {
    const realm = createContext({});
    runInContext(await compiled(), realm, { timeout: 5000 });
    expect(runInContext("Object.keys(OwnedRules.Rules)", realm)).toEqual(["evaluate", "all", "any", "not"]);
    for (const name of ["Xrm", "document", "window", "process", "Buffer"]) expect(realm[name]).toBeUndefined();
  });
  it("uses foreign native receivers, Context identity, JSON and scope helpers in a synchronous enable wrapper", async () => {
    const moduleRealm = createContext({ crypto: globalThis.crypto, TextEncoder, URL });
    const sdkRealm = createContext({});
    const foreign: unknown = runInContext(`(() => {
      const scope = {
        environmentUrl: "https://fixture.example", userId: "11111111-2222-4333-8444-555555555555",
        languageId: 1033, online: true
      };
      const reads = [];
      let value = 0, failure = false;
      const status = {
        getAttributeType() { if (this !== status) throw new Error("type receiver"); return "optionset"; },
        getValue() {
          if (this !== status) throw new Error("value receiver");
          reads.push("status");
          if (failure) throw new Error("native failure");
          return value;
        }
      };
      const entity = {
        getEntityName() { if (this !== entity) throw new Error("entity receiver"); return "account"; },
        getId() { if (this !== entity) throw new Error("id receiver"); return scope.userId; }
      };
      const ui = { getFormType() { if (this !== ui) throw new Error("ui receiver"); return 2; } };
      const form = {
        getAttribute(name) {
          if (this !== form) throw new Error("form receiver");
          return name === "statuscode" ? status : null;
        },
        getControl() { if (this !== form) throw new Error("control receiver"); return null; },
        data: { entity }, ui
      };
      const client = {
        getClientState() { if (this !== client) throw new Error("client receiver"); return "Online"; }
      };
      const current = {
        getClientUrl() { if (this !== current) throw new Error("scope receiver"); return scope.environmentUrl; },
        userSettings: { userId: scope.userId, languageId: scope.languageId }, client
      };
      const utility = {
        getGlobalContext() { if (this !== utility) throw new Error("utility receiver"); return current; }
      };
      const webApi = { retrieveMultipleRecords() { throw new Error("Forbidden network read"); } };
      const conditions = [
        { kind: "record", state: "saved" },
        { kind: "field", field: "statuscode", op: "eq", value: 0 },
        { kind: "prepared", key: "feature", op: "eq", value: false }
      ];
      const options = {
        scope, allowedFields: ["statuscode"], allowedPrepared: [{ key: "feature" }],
        prepared: { scope, values: { feature: { state: "ready", value: false } } }
      };
      return {
        Xrm: { Utility: utility, WebApi: webApi }, form, conditions, options, reads,
        noMatch() { value = 1; }, fail() { value = 0; failure = true; },
        spoof: { surface: "formCommand", form, selection: [] }
      };
    })()`, sdkRealm);
    if (!isRecord(foreign) || !isRecord(foreign.options) ||
        typeof foreign.noMatch !== "function" || typeof foreign.fail !== "function") {
      throw new Error("Invalid foreign native Rules fixture");
    }
    moduleRealm.Xrm = foreign.Xrm;
    moduleRealm.fixture = foreign;
    runInContext(await compiled(), moduleRealm, { timeout: 5000 });
    // Root/browser integration belongs to the parent. Wire only the owned module for this proof.
    runInContext(`
      globalThis.VBD = { Rules: OwnedRules.Rules, Context: OwnedRules.Context };
      const context = VBD.Context.fromFormCommand(fixture.form);
      const plan = VBD.Rules.all(fixture.conditions);
      const options = { ...fixture.options, context };
      function assess() { return VBD.Rules.evaluate(plan, options); }
      function enable() { return assess().state === "matched"; }
    `, moduleRealm);
    expect(runInContext("enable()", moduleRealm)).toBe(true);
    expect(foreign.reads).toEqual(["status"]);
    Reflect.apply(foreign.noMatch, foreign, []);
    expect(runInContext("enable()", moduleRealm)).toBe(false);
    Reflect.apply(foreign.fail, foreign, []);
    expect(() => runInContext("enable()", moduleRealm)).toThrow(expect.objectContaining({
      code: "SDK_OPERATION_FAILED", cause: expect.objectContaining({ message: "native failure" })
    }));
    expect(() => runInContext("VBD.Rules.evaluate(plan, { ...options, context: fixture.spoof })", moduleRealm))
      .toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
  });
  it("rejects foreign accessors/subclasses without executing them and observes foreign guard promises", async () => {
    const realm = createContext({ crypto: globalThis.crypto, TextEncoder, URL });
    runInContext(await compiled(), realm);
    const foreignRealm = createContext({});
    const foreign: unknown = runInContext(`(() => {
      let calls = 0;
      const leaf = { kind: "record", state: "saved" };
      const accessor = Object.defineProperty({ ...leaf }, "state", {
        enumerable: true, get() { calls++; return "saved"; }
      });
      class CustomArray extends Array { map() { calls++; return [leaf]; } }
      const subclass = new CustomArray(); subclass.push(leaf);
      return {
        accessor, subclass,
        rejected: () => Promise.reject(new Error("foreign rejection")),
        calls: () => calls
      };
    })()`, foreignRealm);
    if (!isRecord(foreign) || typeof foreign.calls !== "function") throw new Error("Invalid guard fixture");
    realm.foreign = foreign;
    for (const expression of ["OwnedRules.Rules.not(foreign.accessor)", "OwnedRules.Rules.all(foreign.subclass)"]) {
      expect(() => runInContext(expression, realm)).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
    }
    expect(Reflect.apply(foreign.calls, foreign, [])).toBe(0);
    // This fixture's SDK is local to the compiled realm; the rejecting guard comes from another realm.
    runInContext(`
      const form = { getAttribute() {}, getControl() {}, data: { entity: {} }, ui: {} };
      const scope = {
        environmentUrl: "https://fixture.example", userId: "11111111-2222-4333-8444-555555555555",
        languageId: 1033, online: true
      };
      const scopeContext = { getScope() { return scope; }, retrieveMultipleRecords() { throw new Error("no reads"); } };
      const options = {
        context: OwnedRules.Context.fromFormCommand(form), scope, scopeContext,
        allowedFields: [], allowedPrepared: [{ key: "flag", validate: foreign.rejected }],
        prepared: { scope, values: { flag: { state: "ready", value: false } } }
      };
    `, realm);
    expect(() => runInContext(`OwnedRules.Rules.evaluate({ kind: "prepared", key: "flag", op: "eq", value: false }, options)`, realm))
      .toThrow(expect.objectContaining({ code: "CONFIG_VALUE_INVALID" }));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
});
