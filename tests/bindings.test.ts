import { describe, expect, it, vi } from "vitest";
import { Bindings } from "../src/bindings.js";
import type { BindingType, ValueBinding } from "../src/bindings.js";
import { Config } from "../src/configuration.js";
import { Context } from "../src/context.js";
import { Environment } from "../src/environment.js";
import { appId, deferred, launchFixture, readFixture } from "./environment-helpers.js";
import { configuration } from "./helpers.js";
import { nativeForm } from "./native-fixture.js";

const literal = (value: unknown, type: BindingType = "json"): ValueBinding => ({
  source: { kind: "literal", value }, type,
  ...(type === "json" ? { validate: () => true } : {})
});
const options = () => ({ context: launchFixture().context });
const graph = (key: string, type: BindingType = "number"): ValueBinding => ({ source: { kind: "config", key }, type });

describe("bounded bindings", () => {
  it("resolves false, zero and explicitly empty values with independent runtime checks", async () => {
    const values = await Bindings.resolveMany({
      flag: literal(false, "boolean"), count: literal(0, "number"),
      title: { ...literal("", "text"), allowEmpty: true },
      absent: { ...literal(null, "number"), nullable: true }
    }, options());
    expect(values).toEqual({ flag: false, count: 0, title: "", absent: null });
  });

  it.each([
    literal("", "text"), literal("0", "number"), literal(0, "boolean"), literal(null, "number"),
    literal(NaN, "number"), literal(Infinity, "number"), literal("2026-10-28", "date"), literal([1, 1], "choices"),
    { source: { kind: "literal", value: {} }, type: "json" },
    { ...literal({}, "json"), validate: () => false },
    { ...literal(0, "number"), allowEmpty: true }
  ])("rejects invalid types or missing real schemas (%#)", async binding => {
    await expect(Bindings.resolve(binding as ValueBinding, options())).rejects.toBeDefined();
  });

  it("copies caller literals before yielding and isolates validator mutations and returned values", async () => {
    const original = { nested: { count: 0 } };
    const pending = Bindings.resolve({
      ...literal(original), validate: value => {
        if (typeof value !== "object" || value === null || !("nested" in value) ||
            typeof value.nested !== "object" || value.nested === null || !("count" in value.nested)) return false;
        value.nested.count = 999;
        return true;
      }
    }, options());
    original.nested.count = 5;
    expect(await pending).toEqual({ nested: { count: 0 } });
  });

  it("uses supported form/context helpers and preserves Date and lookup semantics", async () => {
    const form = nativeForm(), host = launchFixture(), operationContext = Context.fromFormCommand(form.form);
    const original = [{ entityType: "ACCOUNT", id: `{${appId.toUpperCase()}}`, name: "Account" }];
    form.field("lookup").data.value = original;
    const result = await Bindings.resolveMany({
      date: { source: { kind: "field", column: "date" }, type: "date" },
      refs: { source: { kind: "field", column: "lookup" }, type: "lookup" },
      false: { source: { kind: "field", column: "enabled" }, type: "boolean" },
      zero: { source: { kind: "field", column: "number" }, type: "number" },
      record: { source: { kind: "context", key: "record" }, type: "json", validate: value => value !== null },
      user: { source: { kind: "context", key: "userId" }, type: "text" },
      language: { source: { kind: "context", key: "languageId" }, type: "number" }
    }, { context: host.context, operationContext, fields: ["date", "lookup", "enabled", "number"] });
    expect(result.date).toBeInstanceOf(Date);
    expect(result.date).not.toBe(form.field("date").data.value);
    expect(result.refs).toEqual([{ entityType: "account", id: appId, name: "Account" }]);
    expect(result.refs).not.toBe(original);
    expect(result.false).toBe(false);
    expect(result.zero).toBe(0);
    expect(result.record).toEqual({ entityType: "account", id: appId });
    expect(result.user).toBe(host.scope.userId);
    expect(result.language).toBe(1033);
    await expect(Bindings.resolve({ source: { kind: "field", column: "date" }, type: "json", validate: () => true }, {
      context: host.context, operationContext, fields: ["date"]
    })).rejects.toBeDefined();
    form.state.type = 1;
    await expect(Bindings.resolve({
      source: { kind: "context", key: "record" }, type: "json", validate: () => true
    }, { context: host.context, operationContext })).rejects.toMatchObject({ code: "UNSAVED_RECORD" });
  });

  it("rejects unapproved and missing fields rather than returning defaults", async () => {
    const form = nativeForm(), operationContext = Context.fromFormCommand(form.form);
    const binding: ValueBinding = { source: { kind: "field", column: "missing" }, type: "text" };
    await expect(Bindings.resolve(binding, { ...options(), operationContext }))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(Bindings.resolve(binding, { ...options(), operationContext, fields: ["missing"] }))
      .rejects.toMatchObject({ code: "FORM_TARGET_MISSING" });
  });

  it("resolves approved environment sources without reinterpreting values", async () => {
    const host = readFixture({
      vbd_False: { type: 100000002, current: "false" }, vbd_Zero: { type: 100000001, current: "0" },
      vbd_Empty: { type: 100000000, current: "", defaultValue: "never" },
      vbd_Json: { type: 100000003, current: '{"safe":true}' }
    });
    const result = await Bindings.resolveMany({
      flag: { source: { kind: "environment", schemaName: "vbd_False" }, type: "boolean" },
      count: { source: { kind: "environment", schemaName: "vbd_Zero" }, type: "number" },
      empty: { source: { kind: "environment", schemaName: "vbd_Empty" }, type: "text", allowEmpty: true },
      json: { source: { kind: "environment", schemaName: "vbd_Json" }, type: "json", validate: v => v !== null }
    }, { context: host.context, environment: ["vbd_False", "vbd_Zero", "vbd_Empty", "vbd_Json"] });
    expect(result).toEqual({ flag: false, count: 0, empty: "", json: { safe: true } });
    await expect(Bindings.resolve({
      source: { kind: "environment", schemaName: "vbd_Zero" }, type: "number"
    }, { context: host.context })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  it.each(["denied", "service", "missing", "ambiguous", "secret"] as const)("fails closed for %s environment reads", async failure => {
    const host = readFixture({ vbd_Test: { type: 100000000, current: "text" } });
    if (failure === "denied") host.retrieve.mockRejectedValue({ status: 403 });
    if (failure === "service") host.retrieve.mockRejectedValue(new Error("network"));
    if (failure === "missing") host.retrieve.mockResolvedValue({ entities: [] });
    if (failure === "ambiguous") host.retrieve.mockResolvedValue({ entities: [{}, {}] });
    if (failure === "secret") host.variable("vbd_Test").type = 100000005;
    await expect(Bindings.resolve({
      source: { kind: "environment", schemaName: "vbd_Test" }, type: "text"
    }, { context: host.context, environment: ["vbd_Test"] })).rejects.toMatchObject({
      code: { denied: "ACCESS_DENIED", service: "DATA_READ_FAILED", missing: "CONFIG_NOT_FOUND",
        ambiguous: "CONFIG_AMBIGUOUS", secret: "SECRET_NOT_SUPPORTED" }[failure]
    });
  });

  it("supports only exact approved own result paths and preserves result Dates", async () => {
    const original = { step: { flag: false, date: new Date("2026-10-28T10:00:00Z") } };
    const result = await Bindings.resolveMany({
      flag: { source: { kind: "result", path: ["step", "flag"] }, type: "boolean" },
      date: { source: { kind: "result", path: ["step", "date"] }, type: "date" }
    }, { ...options(), results: original, resultPaths: [["step", "flag"], ["step", "date"]] });
    expect(result.flag).toBe(false);
    expect(result.date).toEqual(original.step.date);
    expect(result.date).not.toBe(original.step.date);
  });

  it.each(["__proto__", "prototype", "constructor", "getMetadata"])("blocks unsafe path segment %s", async segment => {
    await expect(Bindings.resolve({
      source: { kind: "result", path: ["step", segment] }, type: "json", validate: () => true
    }, { ...options(), results: { step: {} }, resultPaths: [["step", segment]] }))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  it("does not read inherited, getter, missing or unapproved result properties", async () => {
    const getter = vi.fn(() => 0);
    const inherited: unknown = Object.create({ step: { count: 0 } });
    const accessor = Object.defineProperty({}, "step", { enumerable: true, get: getter });
    for (const results of [inherited, accessor, { step: {} }]) {
      await expect(Bindings.resolve({
        source: { kind: "result", path: ["step", "count"] }, type: "number"
      }, { ...options(), results: results as Record<string, unknown>, resultPaths: [["step", "count"]] }))
        .rejects.toBeDefined();
    }
    expect(getter).not.toHaveBeenCalled();
    await expect(Bindings.resolve({
      source: { kind: "result", path: ["step", "count"] }, type: "number"
    }, { ...options(), results: { step: { count: 0 } }, resultPaths: [["step"]] }))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  it("resolves named runtime graph references, rejects missing names and cycles", async () => {
    expect(await Bindings.resolve(graph("a"), {
      ...options(), configuration: { a: graph("b"), b: literal(0, "number") }
    })).toBe(0);
    await expect(Bindings.resolve(graph("missing"), options())).rejects.toMatchObject({ code: "CONFIG_NOT_FOUND" });
    await expect(Bindings.resolve(graph("a"), {
      ...options(), configuration: { a: graph("b"), b: graph("a") }
    })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    const configuration: Record<string, ValueBinding> = {};
    for (let i = 0; i < 10; i++) configuration[`n${i}`] = graph(`n${i + 1}`);
    configuration.n10 = literal(0, "number");
    await expect(Bindings.resolve(graph("n0"), { ...options(), configuration }))
      .rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  });

  it("bounds named counts, expanded work, total bytes, JSON depth and cyclic literals", async () => {
    const many = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`n${i}`, literal(0, "number")]));
    await expect(Bindings.resolveMany(many, options())).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    const expanded = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`n${i}`, graph("n")]));
    await expect(Bindings.resolveMany(expanded, { ...options(), configuration: { n: literal(0, "number") } }))
      .rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    const big = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`n${i}`, literal("x".repeat(40_000), "text")]));
    await expect(Bindings.resolveMany(big, options())).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    await expect(Bindings.resolve(literal(cycle), options())).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    let deep: unknown = 0;
    for (let i = 0; i < 10; i++) deep = { deep };
    await expect(Bindings.resolve(literal(deep), options())).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  });

  it("allows only approved registered configuration variable selection", async () => {
    const host = launchFixture(), name = `binding-${crypto.randomUUID()}`;
    Config.register(name, configuration());
    const binding: ValueBinding = {
      source: { kind: "config", name, variable: "vbd_TargetModelDrivenAppId" }, type: "text"
    };
    await expect(Bindings.resolve(binding, { context: host.context })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(await Bindings.resolve(binding, {
      context: host.context, registered: [{ name, variable: "vbd_TargetModelDrivenAppId" }]
    })).toBe(appId);
  });

  it("snapshots registered revisions before any asynchronous work", async () => {
    const host = launchFixture(), name = `binding-${crypto.randomUUID()}`, gate = deferred();
    Config.register(name, configuration());
    const retrieve = host.context.retrieveMultipleRecords;
    host.context.retrieveMultipleRecords = async (...args) => { await gate.promise; return retrieve(...args); };
    const pending = Bindings.resolveMany({
      env: { source: { kind: "environment", schemaName: "vbd_ApprovedAppOrigin" }, type: "text" },
      config: { source: { kind: "config", name, variable: "vbd_TargetModelDrivenAppId" }, type: "text" }
    }, { context: host.context, environment: ["vbd_ApprovedAppOrigin"], registered: [{ name, variable: "vbd_TargetModelDrivenAppId" }] });
    Config.register(name, configuration(), { replace: true });
    gate.release();
    await expect(pending).rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
  });

  it("rechecks registered revisions even when an environment JSON validator invalidates then fails", async () => {
    const host = readFixture({ vbd_Json: { type: 100000003, current: "{}" } });
    const name = `binding-${crypto.randomUUID()}`;
    Config.register(name, configuration());
    await expect(Bindings.resolveMany({
      json: {
        source: { kind: "environment", schemaName: "vbd_Json" }, type: "json", validate: () => {
          Config.register(name, configuration(), { replace: true });
          return false;
        }
      },
      config: { source: { kind: "config", name, variable: "vbd_TargetModelDrivenAppId" }, type: "text" }
    }, { context: host.context, environment: ["vbd_Json"], registered: [{ name, variable: "vbd_TargetModelDrivenAppId" }] }))
      .rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
  });

  it.each(["scope", "environment"] as const)("detects %s changes across async work and validators", async change => {
    const host = launchFixture(), gate = deferred(), retrieve = host.context.retrieveMultipleRecords;
    host.context.retrieveMultipleRecords = async (...args) => { await gate.promise; return retrieve(...args); };
    const pending = Bindings.resolve({
      source: { kind: "environment", schemaName: "vbd_ApprovedAppOrigin" }, type: "text"
    }, { context: host.context, environment: ["vbd_ApprovedAppOrigin"] });
    if (change === "scope") host.scope.languageId = 1043;
    else Environment.invalidate(undefined, { context: host.context });
    gate.release();
    await expect(pending).rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
    await expect(Bindings.resolve({
      ...literal(0, "number"), validate: () => {
        if (change === "scope") host.scope.languageId++;
        else Environment.invalidate(undefined, { context: host.context });
        return true;
      }
    }, { context: host.context })).rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
  });

  it("observes rejected async predicates without accepting them or delaying on never-settling guards", async () => {
    for (const validate of [
      async () => { throw new Error("async"); },
      () => new Promise<never>(() => undefined),
      () => ({ then: async () => { throw new Error("then"); } })
    ]) {
      await expect(Bindings.resolve({ ...literal({}), validate: validate as never }, options()))
        .rejects.toMatchObject({ code: "CONFIG_VALUE_INVALID" });
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  it("rejects expressions, code, templates, unknown source kinds and unsafe output keys", async () => {
    for (const source of [
      { kind: "expression", code: "return 1" }, { kind: "literal", value: 0, template: "${user}" },
      { kind: "result", path: "step.id" }
    ]) {
      await expect(Bindings.resolve({ source, type: "number" } as never, options()))
        .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    }
    await expect(Bindings.resolveMany({ constructor: literal(0, "number") }, options()))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });
});
