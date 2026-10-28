import { describe, expect, it, vi } from "vitest";
import { Config } from "../src/configuration.js";
import type { ToolkitConfiguration } from "../src/configuration.js";
import { Environment } from "../src/environment.js";
import { deferred, launchFixture, readFixture } from "./environment-helpers.js";
import { configuration } from "./helpers.js";

function declaration(): ToolkitConfiguration {
  const result = Config.validate(configuration());
  if (!result.valid) throw new Error("Invalid fixture");
  return result.configuration;
}
function name(): string { return `runtime-${crypto.randomUUID()}`; }
const accepts = (value: unknown): boolean => typeof value === "object" && value !== null;

describe("approved configuration loading", () => {
  it("retains the full legacy declaration capacities independently of the loader transport budget", () => {
    const longName = (prefix: string, index: number) => `${prefix}${index}`.padEnd(128, "x");
    const config: ToolkitConfiguration = {
      schemaVersion: 1, id: "capacity",
      environmentVariables: Array.from({ length: 200 }, (_, index) => ({
        schemaName: longName("vbd_Variable", index), type: "text", required: true
      })),
      launchProfiles: Array.from({ length: 100 }, (_, index) => ({
        key: longName("profile", index), destinationKind: "modelDrivenApp", presentation: "newWindow",
        appId: { environmentVariable: longName("vbd_Variable", 0) },
        environmentUrl: { environmentVariable: longName("vbd_Variable", 1) },
        allowedOrigins: Array.from({ length: 20 }, (_, origin) => ({
          environmentVariable: longName("vbd_Variable", origin + 2)
        }))
      })),
      registrations: Array.from({ length: 500 }, (_, index) => ({
        id: longName("command", index), surface: "formCommand", profileKey: longName("profile", index % 100)
      }))
    };
    expect(new TextEncoder().encode(JSON.stringify(config)).byteLength).toBeGreaterThan(262_144);
    expect(Config.validate(config).valid).toBe(true);
    const key = name();
    Config.register(key, config);
    expect(Config.get(key)).toEqual(config);
  });

  it("loads bounded declaration JSON, registers it, and isolates returned/caller values", async () => {
    const host = launchFixture(), key = name(), original = declaration();
    const loadJson = vi.fn(async (_maximumBytes: number) => {
      expect(_maximumBytes).toBe(262_144);
      return JSON.stringify(original);
    });
    const loaded = await Config.load(key, {
      kind: "trustedJson", approved: true, loadJson
    }, { context: host.context });
    loaded.id = "changed";
    original.id = "alsoChanged";
    expect(Config.get(key).id).not.toBe("changed");
    expect(Config.get(key).id).not.toBe("alsoChanged");
    expect(() => Config.register(key, declaration())).toThrow(expect.objectContaining({ code: "CONFIG_ALREADY_REGISTERED" }));
    await Config.load(key, {
      kind: "trustedJson", approved: true, loadJson: async () => JSON.stringify(declaration())
    }, { context: host.context, replace: true });
  });

  it.each([
    ["{", "INVALID_JSON"],
    [JSON.stringify({ script: "not-code", schemaVersion: 1 }), "CONFIG_INVALID"],
    [" ".repeat(262_145), "LIMIT_EXCEEDED"],
    [JSON.stringify("é".repeat(140_000)), "LIMIT_EXCEEDED"],
    ['{"constructor":{}}', "INVALID_ARGUMENT"]
  ])("rejects malformed, unsupported and bounded source case %#", async (text, code) => {
    const key = name();
    await expect(Config.load(key, {
      kind: "trustedJson", approved: true, loadJson: async () => text
    }, { context: launchFixture().context })).rejects.toMatchObject({ code });
    expect(() => Config.get(key)).toThrow(expect.objectContaining({ code: "CONFIG_NOT_FOUND" }));
  });

  it("does not fetch URLs, accept scripts or run unapproved loaders", async () => {
    const loader = vi.fn(async () => "{}");
    for (const source of [
      { kind: "url", url: "https://unapproved.example/config.json" },
      { kind: "trustedJson", approved: false, loadJson: loader },
      { kind: "trustedJson", approved: true, loadJson: loader, credentials: "include" }
    ]) {
      await expect(Config.load(name(), source as never, { context: launchFixture().context }))
        .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    }
    expect(loader).not.toHaveBeenCalled();
  });

  it("preserves denied failures and wraps other trusted adapter failures", async () => {
    const { VbdError } = await import("../src/errors.js");
    const denied = new VbdError("ACCESS_DENIED", { operation: "test.read" });
    await expect(Config.load(name(), {
      kind: "trustedJson", approved: true, loadJson: async () => { throw denied; }
    }, { context: launchFixture().context })).rejects.toBe(denied);
    await expect(Config.load(name(), {
      kind: "trustedJson", approved: true, loadJson: async () => { throw new Error("transport"); }
    }, { context: launchFixture().context })).rejects.toMatchObject({ code: "DATA_READ_FAILED" });
  });

  it.each(["scope", "language", "environment", "revision"] as const)(
    "rejects %s changes while loading without overwriting newer registration", async change => {
      const host = launchFixture(), key = name(), gate = deferred();
      const operation = Config.load(key, {
        kind: "trustedJson", approved: true,
        loadJson: async () => { await gate.promise; return JSON.stringify(declaration()); }
      }, { context: host.context, replace: true });
      if (change === "scope") host.scope.userId = crypto.randomUUID();
      if (change === "language") host.scope.languageId = 1043;
      if (change === "environment") Environment.invalidate(undefined, { context: host.context });
      if (change === "revision") Config.register(key, { ...declaration(), id: "newer" });
      gate.release();
      await expect(operation).rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
      if (change === "revision") expect(Config.get(key).id).toBe("newer");
    }
  );
});

describe("registered declaration resolution", () => {
  it("preserves false, zero, explicit empty, JSON and optional absence", async () => {
    const key = name(), config = declaration();
    config.environmentVariables.push(
      { schemaName: "vbd_False", type: "boolean", required: true },
      { schemaName: "vbd_Zero", type: "number", required: true },
      { schemaName: "vbd_Empty", type: "text", required: true },
      { schemaName: "vbd_Json", type: "json", required: true },
      { schemaName: "vbd_Absent", type: "number", required: false }
    );
    const host = readFixture({
      vbd_TargetModelDrivenAppId: { type: 100000000, current: "app" },
      vbd_TargetEnvironmentUrl: { type: 100000000, current: "url" },
      vbd_ApprovedAppOrigin: { type: 100000000, current: "origin" },
      vbd_False: { type: 100000002, current: "false" },
      vbd_Zero: { type: 100000001, current: "0" },
      vbd_Empty: { type: 100000000, current: "", defaultValue: "must-not-use" },
      vbd_Json: { type: 100000003, current: '{"flag":false,"count":0,"title":""}' }
    });
    Config.register(key, config);
    const result = await Config.resolve(key, {
      context: host.context, variables: { vbd_Empty: { allowEmpty: true }, vbd_Json: { validate: accepts } }
    });
    expect(result.values.vbd_False?.value).toBe(false);
    expect(result.values.vbd_Zero?.value).toBe(0);
    expect(result.values.vbd_Empty?.value).toBe("");
    expect(result.values.vbd_Json?.value).toEqual({ flag: false, count: 0, title: "" });
    expect(Object.hasOwn(result.values, "vbd_Absent")).toBe(true);
    expect(result.values.vbd_Absent).toBeUndefined();
    result.configuration.id = "mutated";
    expect(Config.get(key).id).not.toBe("mutated");
  });

  it("rejects overrides, undeclared policy keys and wrong policies before reading", async () => {
    const host = launchFixture(), key = name();
    Config.register(key, declaration());
    for (const options of [
      { allowedOrigins: ["https://other.example"] },
      { overrides: { operation: "anything" } },
      { variables: { missing: { allowEmpty: true } } },
      { variables: { vbd_TargetModelDrivenAppId: { validate: accepts } } }
    ]) {
      await expect(Config.resolve(key, { context: host.context, ...options } as never))
        .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    }
    expect(host.retrieve).not.toHaveBeenCalled();
  });

  it("requires a real JSON predicate, rejects malformed JSON, and rejects async predicates safely", async () => {
    const key = name(), config = declaration(), base = launchFixture();
    config.environmentVariables.push({ schemaName: "vbd_Json", type: "json", required: true });
    Config.register(key, config);
    await expect(Config.resolve(key, { context: base.context })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    const host = readFixture({
      vbd_TargetModelDrivenAppId: { type: 100000000, current: "app" },
      vbd_TargetEnvironmentUrl: { type: 100000000, current: "url" },
      vbd_ApprovedAppOrigin: { type: 100000000, current: "origin" },
      vbd_Json: { type: 100000003, current: "{" }
    });
    await expect(Config.resolve(key, { context: host.context, variables: { vbd_Json: { validate: accepts } } }))
      .rejects.toMatchObject({ code: "CONFIG_VALUE_INVALID" });
    host.variable("vbd_Json").current = "{}";
    const rejected = async (): Promise<boolean> => { throw new Error("async-guard"); };
    await expect(Config.resolve(key, {
      context: host.context, variables: { vbd_Json: { validate: rejected as never } }
    })).rejects.toMatchObject({ code: "CONFIG_VALUE_INVALID" });
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  it.each(["denied", "service", "ambiguous", "secret"] as const)("does not default %s reads", async failure => {
    const host = launchFixture(), key = name();
    Config.register(key, declaration());
    if (failure === "denied") host.retrieve.mockRejectedValue({ status: 403 });
    if (failure === "service") host.retrieve.mockRejectedValue(new Error("network"));
    if (failure === "ambiguous") host.retrieve.mockResolvedValue({ entities: [{}, {}] });
    if (failure === "secret") host.variable("vbd_TargetModelDrivenAppId").type = 100000005;
    await expect(Config.resolve(key, { context: host.context })).rejects.toMatchObject({
      code: { denied: "ACCESS_DENIED", service: "DATA_READ_FAILED", ambiguous: "CONFIG_AMBIGUOUS", secret: "SECRET_NOT_SUPPORTED" }[failure]
    });
  });

  it.each(["revision", "scope", "environment"] as const)("detects %s changes during typed reads", async change => {
    const host = launchFixture(), key = name(), gate = deferred();
    Config.register(key, declaration());
    const retrieve = host.context.retrieveMultipleRecords;
    host.context.retrieveMultipleRecords = async (...args) => { await gate.promise; return retrieve(...args); };
    const pending = Config.resolve(key, { context: host.context });
    if (change === "revision") Config.register(key, declaration(), { replace: true });
    if (change === "scope") host.scope.environmentUrl = "https://another.example";
    if (change === "environment") Environment.invalidate(undefined, { context: host.context });
    gate.release();
    await expect(pending).rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
  });

  it.each(["revision", "scope", "environment"] as const)("checks %s again after a mutating JSON validator", async change => {
    const host = launchFixture(), key = name(), config = declaration();
    config.environmentVariables.push({ schemaName: "vbd_Json", type: "json", required: false });
    Config.register(key, config);
    const json = readFixture({ vbd_Json: { type: 100000003, current: "{}" } });
    const context = {
      getScope: host.context.getScope,
      retrieveMultipleRecords: async (table: string, query: string, max: number) =>
        query.includes("vbd_Json") || query.includes(json.variable("vbd_Json").id)
          ? json.context.retrieveMultipleRecords(table, query, max)
          : host.context.retrieveMultipleRecords(table, query, max)
    };
    await expect(Config.resolve(key, {
      context, variables: { vbd_Json: { validate: () => {
        if (change === "revision") Config.register(key, declaration(), { replace: true });
        if (change === "scope") host.scope.languageId = 1043;
        if (change === "environment") Environment.invalidate(undefined, { context });
        return true;
      } } }
    })).rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
  });

  it("keeps all launch presentations, including registrations, newWindow-only", () => {
    const config = declaration();
    expect(Config.validate({
      ...config, launchProfiles: config.launchProfiles.map(profile => ({ ...profile, presentation: "sameWindow" }))
    }).valid).toBe(false);
  });
});
