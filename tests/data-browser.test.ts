import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { createContext, runInContext, runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { isRecord } from "../src/validation.js";

async function invokeBuilt(api: unknown, namespace: string, method: string, args: unknown[]): Promise<unknown> {
  if (!isRecord(api) || !isRecord(api[namespace])) { throw new Error("Missing built namespace"); }
  const receiver = api[namespace];
  const callable = receiver[method];
  if (typeof callable !== "function") { throw new Error("Missing built method"); }
  const result: unknown = Reflect.apply(callable, receiver, args);
  return result;
}

describe("owned browser modules", () => {
  it.each(["data", "query", "actions"])("builds and imports %s without Xrm, Node or DOM globals", async (name) => {
    const result = await build({
      entryPoints: [fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url))],
      bundle: true, write: false, platform: "browser", target: "es2022", format: "iife",
      globalName: "OwnedData"
    });
    const bundle = result.outputFiles[0]?.text;
    if (!bundle) { throw new Error("Missing in-memory browser build"); }
    const globals: Record<string, unknown> = {};
    expect(() => runInNewContext(bundle, globals, { timeout: 5000 })).not.toThrow();
    expect(globals.OwnedData).toBeDefined();
    for (const absent of ["Xrm", "document", "window", "process", "Buffer", "DOMParser"]) {
      expect(globals[absent]).toBeUndefined();
    }
  });
  it("roundtrips genuine foreign DTOs/options through built modules and a separate VM SDK client", async () => {
    const result = await build({
      stdin: {
        contents: 'export { Data } from "./src/data.ts"; export { Query } from "./src/query.ts"; export { Actions } from "./src/actions.ts";',
        resolveDir: fileURLToPath(new URL("../", import.meta.url)), sourcefile: "data-realm-entry.ts"
      },
      bundle: true, write: false, platform: "browser", target: "es2022", format: "iife", globalName: "OwnedData"
    });
    const bundle = result.outputFiles[0]?.text;
    if (!bundle) { throw new Error("Missing in-memory build"); }
    const moduleRealm = createContext({ crypto: globalThis.crypto, TextEncoder, URL, URLSearchParams });
    runInContext(bundle, moduleRealm, { timeout: 5000 });
    const api: unknown = runInContext("OwnedData", moduleRealm);
    const clientRealm = createContext({});
    const foreign: unknown = runInContext(`(() => {
      const ref = { entityType: "account", id: "11111111-1111-4111-8111-111111111111" };
      const dto = { name: "Synthetic", nested: Object.assign(Object.create(null), { flags: [true, false] }) };
      const state = { creates: 0, received: null, reply: dto };
      const context = {
        getScope: () => ({ environmentUrl: "https://tenant.example", userId: ref.id, languageId: 1033, online: true }),
        retrieveRecord: async () => state.reply,
        retrieveMultipleRecords: async () => ({ entities: [dto] }),
        createRecord: async (_table, data) => { state.creates++; state.received = data; return ref; },
        execute: async () => ({ ok: true, status: 200, json: async () => ({ result: "Synthetic" }) })
      };
      const payload = Object.assign(Object.create(null), { name: "Synthetic" });
      class CustomRecord { constructor() { this.name = "Not a DTO"; } }
      const forgedPrototype = Object.assign(Object.create(null), { constructor: Object });
      return {
        ref, dto, state, payload, client: { context }, columns: ["name"],
        mutation: Object.assign(Object.create(null), { context, allowedFields: ["name"] }),
        query: { entitySet: "accounts", select: ["name"], pageSize: 2 },
        contract: {
          operationName: "vbd_Test",
          parameters: { Settings: { typeName: "mscrm.Settings", structuralProperty: 2, nullable: false,
            validate: value => Object.assign(Object.create(null), { Name: value.Name }) } },
          response: { kind: "json", status: 200, validate: async value => {
            if (typeof value.result !== "string") { throw new Error("Invalid synthetic result"); }
            return { result: value.result };
          } }
        },
        parameters: { Settings: { Name: "Synthetic" } },
        invalid: [new Date(0), new Map(), new CustomRecord(), Object.create(forgedPrototype)],
        unsafe: Object.fromEntries([["__proto__", { polluted: true }]]),
        unsafeDto: Object.fromEntries([["constructor", "unsafe"]])
      };
    })()`, clientRealm);
    if (!isRecord(foreign) || !isRecord(foreign.state) || !isRecord(foreign.dto)) {
      throw new Error("Missing foreign fixture");
    }
    const row = await invokeBuilt(api, "Data", "retrieve", [foreign.ref, foreign.columns, foreign.client]);
    expect(row).toEqual({ name: "Synthetic", nested: { flags: [true, false] } });
    expect(row).not.toBe(foreign.dto);
    if (!isRecord(row) || !isRecord(row.nested) || !isRecord(foreign.dto.nested)) {
      throw new Error("Missing copied nested DTO");
    }
    expect(row.nested.flags).not.toBe(foreign.dto.nested.flags);
    moduleRealm.copied = row;
    expect(runInContext("Object.getPrototypeOf(copied) === Object.prototype", moduleRealm)).toBe(true);
    expect(await invokeBuilt(api, "Data", "create", ["account", foreign.payload, foreign.mutation])).toEqual(foreign.ref);
    expect(foreign.state.received).not.toBe(foreign.payload);
    expect(await invokeBuilt(api, "Query", "executeOData", ["account", foreign.query, foreign.client]))
      .toMatchObject({ complete: true, records: [{ name: "Synthetic" }] });
    expect(await invokeBuilt(api, "Actions", "executeFunction", [foreign.contract, foreign.parameters, foreign.client]))
      .toEqual({ result: "Synthetic" });
    if (!Array.isArray(foreign.invalid)) { throw new Error("Missing foreign invalid objects"); }
    for (const invalid of [...foreign.invalid, foreign.unsafe]) {
      await expect(invokeBuilt(api, "Data", "create", ["account", invalid, foreign.mutation]))
        .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    }
    expect(foreign.state.creates).toBe(1);
    for (const invalid of [...foreign.invalid, foreign.unsafeDto]) {
      foreign.state.reply = invalid;
      await expect(invokeBuilt(api, "Data", "retrieve", [foreign.ref, foreign.columns, foreign.client]))
        .rejects.toMatchObject({ code: "DATA_RESPONSE_INVALID" });
    }
    // Neither foreign payloads nor local JSON copies polluted either realm.
    expect(runInContext("Object.prototype.polluted", moduleRealm)).toBeUndefined();
    expect(runInContext("Object.prototype.polluted", clientRealm)).toBeUndefined();
  });
});
