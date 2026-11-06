import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { isRecord } from "../src/validation.js";

async function compiled() {
  const built = await build({
    entryPoints: [fileURLToPath(new URL("../src/relationships.ts", import.meta.url))],
    bundle: true, write: false, platform: "browser", target: "es2022",
    format: "iife", globalName: "OwnedRelationships"
  });
  const bundle = built.outputFiles[0]?.text;
  if (!bundle) throw new Error("Missing in-memory relationship build");
  return bundle;
}
describe("compiled relationship module", () => {
  it("loads without Xrm, DOM or Node globals and exposes exactly two methods", async () => {
    const realm = createContext({});
    runInContext(await compiled(), realm, { timeout: 5000 });
    expect(runInContext("Object.keys(OwnedRelationships.Relationships)", realm)).toEqual(["associate", "disassociate"]);
    for (const name of ["Xrm", "document", "window", "process", "Buffer"]) {
      expect(realm[name]).toBeUndefined();
    }
  });
  it("uses foreign native SDK receivers, copied contracts and ordered partial outcomes", async () => {
    const moduleRealm = createContext({ crypto: globalThis.crypto, TextEncoder, URL });
    const sdkRealm = createContext({});
    const foreign: unknown = runInContext(`(() => {
      const source = { entityType: "account", id: "11111111-1111-4111-8111-111111111111" };
      const targets = [
        { entityType: "contact", id: "22222222-2222-4222-8222-222222222222" },
        { entityType: "contact", id: "33333333-3333-4333-8333-333333333333" },
        { entityType: "contact", id: "44444444-4444-4444-8444-444444444444" }
      ];
      const scope = { environmentUrl: "https://tenant.example", userId: source.id, languageId: 1033, online: true };
      const relationship = {
        scope, sourceSide: "entity1", cardinality: "collection", navigationProperty: "new_account_contact",
        metadata: {
          kind: "manyToMany", SchemaName: "new_account_contact",
          Entity1LogicalName: "account", Entity2LogicalName: "contact",
          Entity1NavigationPropertyName: "new_account_contact", Entity2NavigationPropertyName: "new_account_contact",
          IntersectEntityName: "new_account_contact", Entity1IntersectAttribute: "accountid", Entity2IntersectAttribute: "contactid"
        }
      };
      const calls = [];
      let denialAt = 0;
      const online = {
        async execute(request) {
          if (this !== online || Object.hasOwn(request, "getMetadata")) throw new Error("Receiver/prototype mismatch");
          const metadata = request.getMetadata();
          if (metadata.operationType !== 2 || metadata.boundParameter !== null ||
              Object.keys(metadata.parameterTypes).length !== 0) throw new Error("Invented metadata");
          calls.push({ request, metadata });
          if (denialAt && calls.length === denialAt) return { ok: false, status: 403, message: "private SDK payload" };
          return { ok: true, status: 204 };
        }
      };
      const client = {
        getClientState() { if (this !== client) throw new Error("client receiver"); return "Online"; }
      };
      const current = {
        getClientUrl() { if (this !== current) throw new Error("context receiver"); return scope.environmentUrl; },
        userSettings: { userId: source.id, languageId: 1033 }, client
      };
      const utility = {
        getGlobalContext() { if (this !== utility) throw new Error("utility receiver"); return current; }
      };
      return {
        Xrm: { Utility: utility, WebApi: { online } }, source, targets, relationship, calls,
        confirmation: { policy: "confirm-disassociate", source, targets, relationship },
        denySecond() { calls.length = 0; denialAt = 2; }
      };
    })()`, sdkRealm);
    if (!isRecord(foreign) || typeof foreign.denySecond !== "function" ||
        !Array.isArray(foreign.calls) || !Array.isArray(foreign.targets)) {
      throw new Error("Invalid foreign relationship fixture");
    }
    moduleRealm.Xrm = foreign.Xrm;
    runInContext(await compiled(), moduleRealm, { timeout: 5000 });
    // Namespace integration is parent-owned; this fixture wires only the owned module.
    runInContext("globalThis.VBD = { Relationships: OwnedRelationships.Relationships }", moduleRealm);
    const api: unknown = runInContext("VBD.Relationships", moduleRealm);
    if (!isRecord(api) || typeof api.associate !== "function" || typeof api.disassociate !== "function") {
      throw new Error("Missing compiled relationship APIs");
    }
    const complete: unknown = await Reflect.apply(api.associate, api,
      [foreign.source, foreign.relationship, foreign.targets]);
    expect(complete).toMatchObject({
      status: "completed", counts: { requested: 3, attempted: 3, completed: 3, failed: 0, uncertain: 0, skipped: 0 }
    });
    expect(foreign.calls[0]).toMatchObject({
      request: { target: foreign.source, relatedEntities: [foreign.targets[0]], relationship: "new_account_contact" },
      metadata: { operationName: "Associate" }
    });
    Reflect.apply(foreign.denySecond, foreign, []);
    const partial: unknown = await Reflect.apply(api.disassociate, api,
      [foreign.source, foreign.relationship, foreign.targets, { confirmation: foreign.confirmation }]);
    expect(partial).toMatchObject({
      status: "partial", counts: { requested: 3, attempted: 2, completed: 1, failed: 1, uncertain: 0, skipped: 1 },
      error: { code: "ACCESS_DENIED" },
      items: [{ status: "completed" }, { status: "failed" }, { status: "skipped" }]
    });
    expect(foreign.calls).toHaveLength(2);
    expect(JSON.stringify(partial)).not.toContain("private SDK payload");
  });
});
