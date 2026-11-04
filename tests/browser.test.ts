import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext, runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { configuration } from "./helpers.js";
import { appId, launchFixture } from "./environment-helpers.js";
import * as library from "../src/index.js";
import { nativeForm } from "./native-fixture.js";

const bundle = readFileSync(resolve("dist", "vbd.toolkit.js"), "utf8");

describe("browser distribution", () => {
  it("uses compiled explicit localization and display contracts without guessed native locale", () => {
    const foreignDate = new Date("2026-01-01T00:30:00Z");
    const result: unknown = runInNewContext(`${bundle}
      JSON.stringify({
        locale:VBD.I18n.getLanguage({context:{
          environmentUrl:"https://fixture.example",userId:"11111111-2222-3333-4444-555555555555",languageId:1033
        }}).locale,
        translated:VBD.I18n.translate("status","en-US",{
          resources:{"en-US":{status:"{count}/{enabled}"}},onMissing:"error",values:{count:0,enabled:false}
        }),
        number:VBD.I18n.formatNumber(1234.5,"de-DE",{style:"decimal"}),
        date:VBD.I18n.formatDate("2024-02-29","en-GB",{behavior:"dateOnly",dateStyle:"long"}),
        display:VBD.Utils.formatValue({kind:"boolean",value:false,labels:{true:"Yes",false:"No"}},
          {locale:"en-US",nulls:{policy:"error"}}),
        dateIsForeign:!(foreignDate instanceof Date),
        userLocal:VBD.I18n.formatDate(foreignDate,"en-GB",{
          behavior:"userLocal",dateStyle:"long",timeStyle:"short",timeZone:"America/New_York"
        })
      });`, { crypto: globalThis.crypto, URL, TextEncoder, foreignDate }, { timeout: 5000 });
    if (typeof result !== "string") throw new Error("Missing serialized localization result.");
    expect(JSON.parse(result)).toEqual({
      locale: null, translated: "0/false", number: new Intl.NumberFormat("de-DE").format(1234.5),
      date: new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", dateStyle: "long" }).format(new Date("2024-02-29T00:00:00Z")),
      display: "No", dateIsForeign: true,
      userLocal: new Intl.DateTimeFormat("en-GB", {
        dateStyle: "long", timeStyle: "short", timeZone: "America/New_York"
      }).format(foreignDate)
    });
  });
  it("retries explicit throttled read evidence and computes compiled preflight without native calls", async () => {
    const source = launchFixture();
    const result: unknown = await runInNewContext(`${bundle}
      (async () => {
        const attempts = [];
        const value = await VBD.Execution.withRetry(({attempt}) => {
          attempts.push(attempt);
          if (attempt === 1) throw {status:429,retryAfter:0};
          return false;
        }, {readOnly:true,context:readContext,policy:{initialDelayMs:0,maxDelayMs:0}});
        const report = await VBD.Execution.preflight([{
          id:"fixtureRead",readOnly:true,run:()=>({status:"pass",reason:"confirmed"})
        }], {context:readContext});
        return JSON.stringify({value,attempts,status:report.status,basis:report.basis,counts:report.counts});
      })();`, {
      crypto: globalThis.crypto, URL, setTimeout, clearTimeout, performance: globalThis.performance,
      readContext: source.context
    }, { timeout: 5000 });
    if (typeof result !== "string") throw new Error("Missing serialized retry/preflight result.");
    expect(JSON.parse(result)).toEqual({
      value: false, attempts: [1, 2], status: "ready", basis: "trusted-read-only-checks",
      counts: { total: 1, executed: 1, pass: 1, fail: 0, unknown: 0, unsupported: 0, observerFailed: 0 }
    });
    expect(source.retrieve).not.toHaveBeenCalled();
  });
  it("does not turn optional localization into a prerequisite for Core initialization", () => {
    const result: unknown = runInNewContext(`${bundle}
      let localeError;
      try {VBD.I18n.formatNumber(1,"en-US",{style:"decimal"});}
      catch(error) {localeError=error.code;}
      JSON.stringify({version:VBD.Diagnostics.getVersion(),valid:VBD.Config.validate({}).valid,localeError});`,
    { crypto: globalThis.crypto, Intl: undefined }, { timeout: 5000 });
    expect(result).toBe(JSON.stringify({ version: manifest.version, valid: false, localeError: "UNSUPPORTED_SURFACE" }));
  });
  it("reports actual compiled read-batch partial outcomes with isolated values and redacted errors", async () => {
    const source = launchFixture();
    const result: unknown = await runInNewContext(`${bundle}
      (async () => {
        const report = await VBD.Batch.execute([
          {id:"zero",kind:"read",run:()=>0,validate:value=>typeof value==="number"},
          {id:"failed",kind:"read",run:()=>{throw new Error("PRIVATE_BATCH_CANARY");},validate:()=>true},
          {id:"after",kind:"read",run:()=>false,validate:value=>typeof value==="boolean"}
        ], {context:readContext,concurrency:1,failurePolicy:"continue"});
        return JSON.stringify(report);
      })();`, { crypto: globalThis.crypto, URL, TextEncoder, readContext: source.context }, { timeout: 5000 });
    expect(typeof result).toBe("string");
    if (typeof result !== "string") throw new Error("Missing serialized read batch.");
    expect(result).not.toContain("PRIVATE_BATCH_CANARY");
    expect(JSON.parse(result)).toMatchObject({
      status: "partial", stopReason: "none",
      items: [
        { id: "zero", status: "succeeded", value: 0 },
        { id: "failed", status: "failed", error: { code: "OPERATION_FAILED" } },
        { id: "after", status: "succeeded", value: false }
      ],
      counts: { total: 3, attempted: 3, succeeded: 2, failed: 1, skipped: 0 }
    });
    expect(source.retrieve).not.toHaveBeenCalled();
  });
  it("uses compiled choice baseline tokens and a permitted form selector across realms", async () => {
    const fixture = nativeForm(), targetFormId = crypto.randomUUID(), currentFormId = crypto.randomUUID();
    let options: library.ChoiceOption[] = [{ value: 0, text: "" }, { value: 1, text: "One" }];
    let selected: number | null = 0;
    const attribute: Record<string, unknown> = {};
    const control = {
      getName: () => "status", getControlType: () => "choice", getAttribute: () => attribute,
      getOptions: () => options.map(item => ({ ...item })),
      clearOptions: () => { options = []; },
      addOption: (option: library.ChoiceOption, index: number) => { options.splice(index, 0, { ...option }); }
    };
    Object.assign(attribute, {
      getName: () => "status", getAttributeType: () => "optionset", getValue: () => selected,
      setValue: (value: number | null) => { selected = value; }, controls: { get: () => [control] }
    });
    const navigated: unknown[] = [];
    const currentItem = { getId: () => currentFormId, navigate: () => { throw new Error("Already-current form must not navigate."); } };
    const targetItem = { getId: () => targetFormId, navigate() { navigated.push(this); } };
    const form = {
      ...fixture.form,
      getAttribute: (name: string) => name === "status" ? attribute : fixture.form.getAttribute(name),
      getControl: (name: string) => name === "status" ? control : fixture.form.getControl(name),
      ui: {
        ...fixture.form.ui, formSelector: { items: { get: () => [currentItem, targetItem] }, getCurrentItem: () => currentItem }
      }
    };
    const result: unknown = await runInNewContext(`${bundle}
      (async () => {
        const changed = VBD.Choices.setOptions(form, "status", [{value:0,text:"Only zero"}]);
        const restored = VBD.Choices.restoreOptions(form, "status", changed.baseline);
        const switched = await VBD.Forms.switchForm(form, targetFormId);
        return JSON.stringify({changed:changed.status,restored:restored.status,switched});
      })();`, {
      crypto: globalThis.crypto, form, targetFormId,
      Xrm: { Utility: { getGlobalContext: () => ({
        client: { getClient: () => "Web", getFormFactor: () => 1, getClientState: () => "Online" }
      }) } }
    }, { timeout: 5000 });
    expect(result).toBe(JSON.stringify({
      changed: "applied", restored: "restored", switched: { status: "requested", formId: targetFormId }
    }));
    expect(options).toEqual([{ value: 0, text: "" }, { value: 1, text: "One" }]);
    expect(selected).toBe(0);
    expect(navigated).toEqual([targetItem]);
    expect(fixture.form.data.save).not.toHaveBeenCalled();
  });
  it("uses compiled metadata adapters without guessing native choices or relationship identities", async () => {
    const source = launchFixture(), calls: string[] = [];
    const metadataContext: library.MetadataContext = {
      getScope: () => ({ ...source.scope }),
      getTable: async () => {
        calls.push("table");
        return { scope: { ...source.scope }, complete: true, metadata: { LogicalName: "account", EntitySetName: "accounts" } };
      },
      getChoices: async () => {
        calls.push("choices");
        return {
          scope: { ...source.scope }, complete: true, metadata: {
            EntityLogicalName: "account", LogicalName: "accountcategorycode", AttributeType: 11,
            kind: "picklist", Options: [{ Value: 0, Labels: [{ LanguageCode: 1033, Label: "" }] }]
          }
        };
      },
      getRelationships: async () => {
        calls.push("relationships");
        return {
          scope: { ...source.scope }, complete: true, metadata: [{
            kind: "oneToMany", SchemaName: "account_contacts",
            ReferencedEntity: "account", ReferencedAttribute: "accountid",
            ReferencingEntity: "contact", ReferencingAttribute: "parentcustomerid",
            ReferencedEntityNavigationPropertyName: "contact_customer_accounts",
            ReferencingEntityNavigationPropertyName: "parentcustomerid_account"
          }]
        };
      }
    };
    const result: unknown = await runInNewContext(`${bundle}
      (async () => {
        const table = await VBD.Metadata.getTable("account", {context:metadataContext});
        const choices = await VBD.Metadata.getChoices("account", "accountcategorycode",
          {context:metadataContext,languageId:1033});
        const relationships = await VBD.Metadata.getRelationships("account",
          {context:metadataContext,kind:"oneToMany"});
        return JSON.stringify({table,choice:choices.choices[0],
          relationship:relationships.relationships[0].SchemaName});
      })();`, { crypto: globalThis.crypto, URL, TextEncoder, metadataContext }, { timeout: 5000 });
    expect(result).toBe(JSON.stringify({
      table: { LogicalName: "account", EntitySetName: "accounts" },
      choice: { value: 0, label: "", languageId: 1033, isFallback: false },
      relationship: "account_contacts"
    }));
    expect(calls).toEqual(["table", "choices", "relationships"]);
    expect(source.retrieve).not.toHaveBeenCalled();
  });
  it("reserves bundled operation locks without browser storage, DOM or native reads", async () => {
    const source = launchFixture();
    const result: unknown = await runInNewContext(`${bundle}
      (async () => {
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const key = { namespace: "vm", key: "operation" };
        const first = VBD.Execution.withLock(key, async () => { await gate; return false; }, {context:readContext});
        const duplicate = await VBD.Execution.withLock(key, () => {throw new Error("Must not run");},
          {context:readContext,duplicate:"return-busy"});
        release();
        return JSON.stringify({duplicate,first:await first});
      })();`, { crypto: globalThis.crypto, URL, readContext: source.context }, { timeout: 5000 });
    expect(result).toBe(JSON.stringify({ duplicate: { status: "busy" }, first: { status: "completed", value: false } }));
    expect(source.retrieve).not.toHaveBeenCalled();
  });
  it("uses the bundled configuration, binding, cache and same-window contracts across realms", async () => {
    const source = launchFixture(), opened: string[] = [];
    const config = configuration();
    const sandbox = {
      crypto: globalThis.crypto, URL, TextEncoder, config,
      readContext: source.context,
      host: { navigateSameWindow: (url: string) => { opened.push(url); } }
    };
    const result: unknown = await runInNewContext(`${bundle}
      (async () => {
        config.launchProfiles[0].presentation = "sameWindow";
        config.registrations = [];
        VBD.Config.register("vmSame", config);
        const bindings = await VBD.Bindings.resolveMany({
          enabled: { source: {kind:"literal", value:false}, type:"boolean" },
          count: { source: {kind:"literal", value:0}, type:"number" }
        }, { context:readContext });
        const cached = await VBD.Cache.getOrLoad({namespace:"vm",key:"settings"}, {
          context:readContext, approved:true, purpose:"metadata", revision:"v1", ttlMs:1000,
          load:async()=>({enabled:false}), validate:value=>value.enabled===false
        });
        const resolved = await VBD.Config.resolve("vmSame", {context:readContext});
        const request = await VBD.Launch.openProfile({
          configurationName:"vmSame",profileKey:"customerWorkspace",context:readContext,host
        });
        return JSON.stringify({ bindings, cached, resolved:Object.keys(resolved.values).length,
          request, security:typeof VBD.Security.assessTable });
      })();`, sandbox, { timeout: 5000 });
    expect(result).toBe(JSON.stringify({
      bindings: { enabled: false, count: 0 }, cached: { enabled: false }, resolved: 3,
      request: { status: "requested", outcome: "unknown", presentation: "sameWindow" },
      security: "function"
    }));
    expect(opened).toEqual([`https://target.example/main.aspx?appid=${appId}`]);
    expect(source.retrieve).toHaveBeenCalledTimes(6);
  });
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
