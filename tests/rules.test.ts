import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { Context } from "../src/context.js";
import { Environment } from "../src/environment.js";
import { VbdError } from "../src/errors.js";
import { Rules } from "../src/rules.js";
import type {
  RuleAll, RuleAny, RuleAssessment, RuleComparison, RuleCondition, RuleEvaluationOptions,
  RuleNot, RulePreparedFact, RuleScalar
} from "../src/rules.js";
import { nativeForm, nativeGrid, nativeSdk } from "./native-fixture.js";
import { readFixture } from "./environment-helpers.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const yes: RuleCondition = { kind: "prepared", key: "flag", op: "eq", value: true };
const no: RuleCondition = { kind: "prepared", key: "flag", op: "eq", value: false };
const missing: RuleCondition = { kind: "prepared", key: "missing", op: "eq", value: true };
function setup() {
  const form = nativeForm(), read = readFixture({});
  const values: Record<string, RulePreparedFact> = { flag: { state: "ready", value: true } };
  const options: RuleEvaluationOptions = {
    context: Context.fromFormCommand(form.form), scope: { ...read.scope }, scopeContext: read.context,
    allowedFields: ["name", "number", "enabled", "lookup", "choices", "date", "statuscode", "absent"],
    allowedPrepared: [{ key: "flag" }, { key: "missing" }],
    prepared: { scope: { ...read.scope }, values }
  };
  return { form, read, options, values };
}
function run(input: unknown, options: unknown): RuleAssessment {
  return Reflect.apply(Rules.evaluate, Rules, [input, options]) as RuleAssessment;
}
function field(name: string, op: "eq" | "ne", value: RuleScalar): RuleCondition {
  return { kind: "field", field: name, op, value };
}

describe("Rules public synchronous contracts and three-valued logic", () => {
  it("exposes exactly four APIs and precise immutable types", () => {
    expect(Object.keys(Rules)).toEqual(["evaluate", "all", "any", "not"]);
    expectTypeOf(Rules.all([yes])).toEqualTypeOf<RuleAll>();
    expectTypeOf(Rules.any([yes])).toEqualTypeOf<RuleAny>();
    expectTypeOf(Rules.not(yes)).toEqualTypeOf<RuleNot>();
    expectTypeOf(Rules.evaluate(yes, setup().options)).toEqualTypeOf<RuleAssessment>();
    const comparison: RuleComparison = { op: "gt", value: 0 };
    expect(comparison.value).toBe(0);
    // @ts-expect-error Ordered operands must be numbers, not coercible strings.
    const invalid: RuleComparison = { op: "gt", value: "0" };
    expect(invalid.value).toBe("0");
  });
  it("copies and deep-freezes constructors without freezing the caller's input", () => {
    const input = [yes], composite = Rules.all(input);
    input.push(no);
    expect(composite.conditions).toHaveLength(1);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(composite)).toBe(true);
    expect(Object.isFrozen(composite.conditions)).toBe(true);
    expect(Object.isFrozen(composite.conditions[0])).toBe(true);
    const f = setup(), result = Rules.evaluate(composite, f.options);
    expect(result).toMatchObject({ state: "matched", reason: "all-satisfied", basis: "ux-only" });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.children)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/source\.example|userId|flag/);
    expect(f.read.retrieve).not.toHaveBeenCalled();
  });
  it.each([
    [yes, yes, "matched", "matched"], [yes, no, "notMatched", "matched"],
    [yes, missing, "unknown", "matched"], [no, yes, "notMatched", "matched"],
    [no, no, "notMatched", "notMatched"], [no, missing, "notMatched", "unknown"],
    [missing, yes, "unknown", "matched"], [missing, no, "notMatched", "unknown"],
    [missing, missing, "unknown", "unknown"]
  ] as const)("preserves AND/OR truth tables for %j and %j", (a, b, and, or) => {
    const f = setup();
    expect(Rules.evaluate(Rules.all([a, b]), f.options).state).toBe(and);
    expect(Rules.evaluate(Rules.any([a, b]), f.options).state).toBe(or);
  });
  it.each([
    [yes, "notMatched", "negated-match"], [no, "matched", "negated-no-match"],
    [missing, "unknown", "negated-unknown"]
  ] as const)("never negates unknown to true: %j", (condition, state, reason) => {
    const f = setup(), result = Rules.evaluate(Rules.not(condition), f.options);
    expect(result).toMatchObject({ state, reason });
    expect(result.children).toHaveLength(1);
  });
  it("retains unknown reasons and records only visited branches in declaration order", () => {
    const f = setup();
    const result = Rules.evaluate(Rules.all([missing, no, field("name", "eq", null)]), f.options);
    expect(result).toMatchObject({
      state: "notMatched", reason: "all-not-matched",
      children: [{ state: "unknown", reason: "prepared-missing" }, { state: "notMatched" }]
    });
    expect(result.children).toHaveLength(2);
    expect(f.form.form.getAttribute).not.toHaveBeenCalled();
    const nested = Rules.not(Rules.any([missing, no]));
    expect(Rules.evaluate(nested, f.options).state).toBe("unknown");
  });
  it("supports bounded JSON text and rejects strings as executable or registered names", () => {
    const f = setup();
    expect(Rules.evaluate(JSON.stringify(yes), f.options).state).toBe("matched");
    for (const text of ["flag", "true", "null", "[]", "{", "return true", '{"kind":"script","code":"true"}']) {
      expect(() => Rules.evaluate(text, f.options)).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
    }
  });
});

describe("prepared facts are explicit current-scope caller inputs", () => {
  it.each([false, 0, "", null, true, 2, "value"] as const)("compares %j without truthiness or coercion", value => {
    const f = setup();
    f.values.flag = { state: "ready", value };
    expect(Rules.evaluate({ ...yes, value }, f.options).state).toBe("matched");
    expect(Rules.evaluate({ ...yes, op: "ne", value }, f.options).state).toBe("notMatched");
  });
  it("distinguishes missing, not-ready and explicit null", () => {
    const f = setup();
    delete f.values.flag;
    expect(Rules.evaluate(yes, f.options).reason).toBe("prepared-missing");
    f.values.flag = { state: "notReady" };
    expect(Rules.evaluate(Rules.not(yes), f.options).state).toBe("unknown");
    expect(Rules.evaluate(yes, f.options).reason).toBe("prepared-not-ready");
    f.values.flag = { state: "ready", value: null };
    expect(Rules.evaluate({ ...yes, value: null }, f.options).state).toBe("matched");
    const { prepared: _prepared, ...without } = f.options;
    void _prepared;
    expect(Rules.evaluate(yes, without).state).toBe("unknown");
  });
  it.each([
    ["lt", 1, 2, "matched"], ["lte", 2, 2, "matched"], ["gt", 3, 2, "matched"],
    ["gte", 2, 2, "matched"], ["gt", 0, 0, "notMatched"], ["gte", null, 0, "notMatched"],
    ["gt", "3", 2, "notMatched"], ["lt", false, 1, "notMatched"]
  ] as const)("implements numeric %s on %j versus %j", (op, actual, value, state) => {
    const f = setup();
    f.values.flag = { state: "ready", value: actual };
    expect(Rules.evaluate({ kind: "prepared", key: "flag", op, value }, f.options).state).toBe(state);
  });
  it.each([
    undefined, { state: "ready" }, { state: "ready", value: undefined }, { state: "ready", value: Number.NaN },
    { state: "ready", value: Infinity }, { state: "ready", value: [] }, { state: "ready", value: {} },
    { state: "ready", value: new Date() }, { state: "notReady", value: null }, { state: "missing" }
  ])("does not turn invalid prepared input %j into unknown, even when unused", fact => {
    const f = setup();
    expect(() => run(Rules.any([yes, missing]), {
      ...f.options, prepared: { scope: f.read.scope, values: { flag: f.values.flag, missing: fact } }
    })).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
    expect(f.form.form.getAttribute).not.toHaveBeenCalled();
  });
  it("validates every supplied ready fact before short-circuiting, never computes arbitrary rules", () => {
    const f = setup(), guard = vi.fn(() => false);
    f.values.missing = { state: "ready", value: 0 };
    expect(() => Rules.evaluate(Rules.any([yes, missing]), {
      ...f.options, allowedPrepared: [{ key: "flag" }, { key: "missing", validate: guard }]
    })).toThrow(expect.objectContaining({ code: "CONFIG_VALUE_INVALID" }));
    expect(guard).toHaveBeenCalledExactlyOnceWith(0);
    f.values.missing = { state: "notReady" };
    guard.mockClear();
    expect(Rules.evaluate(yes, {
      ...f.options, allowedPrepared: [{ key: "flag" }, { key: "missing", validate: guard }]
    }).state).toBe("matched");
    expect(guard).not.toHaveBeenCalled();
  });
  it.each([false, undefined, 0, "true", {}, null])("rejects invalid guard result %j", value => {
    const f = setup();
    expect(() => run(yes, { ...f.options, allowedPrepared: [{ key: "flag", validate: () => value }] }))
      .toThrow(expect.objectContaining({ code: "CONFIG_VALUE_INVALID" }));
  });
  it("retains guard throws and observes rejecting foreign/async outputs", async () => {
    const f = setup(), original = new Error("guard failed");
    expect(() => Rules.evaluate(yes, {
      ...f.options, allowedPrepared: [{ key: "flag", validate: () => { throw original; } }]
    })).toThrow(expect.objectContaining({ code: "CONFIG_VALUE_INVALID", cause: original }));
    expect(() => run(yes, {
      ...f.options, allowedPrepared: [{ key: "flag", validate: async () => { throw original; } }]
    })).toThrow(expect.objectContaining({ code: "CONFIG_VALUE_INVALID" }));
    const then = vi.fn(async () => { throw original; });
    expect(() => run(yes, {
      ...f.options, allowedPrepared: [{ key: "flag", validate: () => ({ then }) }]
    })).toThrow(expect.objectContaining({ code: "CONFIG_VALUE_INVALID" }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(then).toHaveBeenCalledOnce();
  });
  it("isolates source mutations made by guards from the validated tree/facts/policies", () => {
    const f = setup(), condition = { ...yes };
    const allowedFields = ["name"];
    const guard = vi.fn(() => {
      condition.value = false;
      f.values.flag = { state: "notReady" };
      allowedFields.length = 0;
      return true;
    });
    const result = Rules.evaluate(condition, {
      ...f.options, allowedFields, allowedPrepared: [{ key: "flag", validate: guard }]
    });
    expect(result.state).toBe("matched");
    expect(guard).toHaveBeenCalledOnce();
    expect(Rules.evaluate(yes, f.options).state).toBe("unknown");
  });
});

describe("native observations stay synchronous, scoped and UX-only", () => {
  it.each([
    [1, "", "unsaved"], [2, "", "unsaved"], [2, "{}", "unsaved"],
    [2, "11111111-2222-3333-4444-555555555555", "saved"], [3, "11111111-2222-3333-4444-555555555555", "saved"],
    [0, "", "none"], [6, "", "none"]
  ] as const)("uses Context record semantics for form type %s / id %s", (type, id, state) => {
    const f = setup();
    f.form.state.type = type; f.form.state.id = id;
    expect(Rules.evaluate({ kind: "record", state: "saved" }, f.options).state)
      .toBe(state === "none" ? "unknown" : state === "saved" ? "matched" : "notMatched");
    expect(Rules.evaluate({ kind: "record", state: "unsaved" }, f.options).state)
      .toBe(state === "none" ? "unknown" : state === "unsaved" ? "matched" : "notMatched");
  });
  it("rejects malformed record SDK results, instead of treating them as unsaved", () => {
    const f = setup();
    f.form.state.id = "bad";
    expect(() => Rules.evaluate({ kind: "record", state: "saved" }, f.options))
      .toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
    f.form.state.type = 5;
    expect(() => Rules.evaluate({ kind: "record", state: "saved" }, f.options))
      .toThrow(expect.objectContaining({ code: "DATA_RESPONSE_INVALID" }));
  });
  it("uses normalized Context selection snapshots, not all rows or live rereads", () => {
    const f = setup(), grid = nativeGrid(), context = Context.fromGridCommand(grid.grid);
    const options = { ...f.options, context };
    grid.state.references = [];
    expect(Rules.evaluate({ kind: "selection", min: 1, max: 1, tables: ["ACCOUNT"] }, options).state).toBe("matched");
    expect(Rules.evaluate({ kind: "selection", min: 0, max: 0 }, options).state).toBe("notMatched");
    expect(Rules.evaluate({ kind: "selection", min: 1, max: 1, tables: ["contact"] }, options).state).toBe("notMatched");
    expect(Rules.evaluate({ kind: "record", state: "saved" }, options).state).toBe("matched");
    const empty = { ...options, context: Context.fromGridCommand(grid.grid) };
    expect(Rules.evaluate({ kind: "selection", min: 0, max: 0 }, empty).state).toBe("matched");
    expect(Rules.evaluate({ kind: "record", state: "saved" }, empty).reason).toBe("record-unavailable");
    expect(Rules.evaluate({ kind: "selection", min: 0, max: 1 }, f.options).reason).toBe("selection-surface-unavailable");
  });
  it("supports only native form/grid capability checks and field surface absence", () => {
    const f = setup(), grid = nativeGrid(), options = { ...f.options, context: Context.fromGridCommand(grid.grid) };
    expect(Rules.evaluate({ kind: "capability", name: "form" }, f.options).state).toBe("matched");
    expect(Rules.evaluate({ kind: "capability", name: "grid" }, f.options).state).toBe("notMatched");
    expect(Rules.evaluate({ kind: "capability", name: "grid" }, options).state).toBe("matched");
    expect(Rules.evaluate(field("name", "eq", null), options).reason).toBe("field-surface-unavailable");
    expect(() => run({ kind: "capability", name: "online" }, f.options)).toThrow();
  });
  it("handles native false, zero, null and unloaded fields without coercion", () => {
    const f = setup();
    for (const [name, value] of [["enabled", false], ["number", 0], ["name", null]] as const) {
      expect(Rules.evaluate(field(name, "eq", value), f.options).state).toBe("matched");
    }
    f.form.field("name").data.value = "";
    expect(Rules.evaluate(field("name", "eq", ""), f.options).state).toBe("matched");
    expect(Rules.evaluate(field("number", "eq", "0"), f.options).state).toBe("notMatched");
    expect(Rules.evaluate(field("absent", "eq", null), f.options).reason).toBe("field-not-loaded");
    expect(Rules.evaluate(Rules.not(field("absent", "ne", null)), f.options).state).toBe("unknown");
  });
  it.each(["decimal", "double", "money", "integer", "optionset", "string", "memo", "boolean"])(
    "checks the supported native scalar type %s", type => {
      const f = setup(), value = type === "boolean" ? false : ["string", "memo"].includes(type) ? "" : 0;
      f.form.field("name").data.type = type; f.form.field("name").data.value = value;
      expect(Rules.evaluate(field("name", "eq", value), f.options).state).toBe("matched");
    }
  );
  it.each(["lookup", "datetime", "multiselectoptionset", "file", "image"])("rejects unsupported native type %s", type => {
    const f = setup();
    f.form.field("name").data.type = type;
    expect(() => Rules.evaluate(field("name", "eq", null), f.options))
      .toThrow(expect.objectContaining({ code: "FIELD_TYPE_MISMATCH" }));
  });
  it.each([undefined, Number.NaN, Infinity, {}, Promise.resolve(0), "0", 1.5])(
    "does not hide invalid integer SDK result %j as unknown", value => {
      const f = setup();
      f.form.field("number").data.value = value;
      expect(() => Rules.evaluate(field("number", "eq", 0), f.options))
        .toThrow(expect.objectContaining({ code: "DATA_RESPONSE_INVALID" }));
    }
  );
  it("does not hide getAttribute undefined, bad type, missing method or SDK exceptions", () => {
    const f = setup(), original = new Error("native failed");
    f.form.form.getAttribute.mockImplementationOnce(() => { throw original; });
    expect(() => Rules.evaluate(field("name", "eq", null), f.options))
      .toThrow(expect.objectContaining({ code: "SDK_OPERATION_FAILED", cause: original }));
    f.form.form.getAttribute.mockReturnValueOnce(undefined as never);
    expect(() => Rules.evaluate(field("name", "eq", null), f.options)).toThrow(expect.objectContaining({ code: "UNSUPPORTED_SURFACE" }));
    f.form.field("name").data.type = "invented";
    expect(() => Rules.evaluate(field("name", "eq", null), f.options)).toThrow(expect.objectContaining({ code: "DATA_RESPONSE_INVALID" }));
    f.form.form.getAttribute.mockReturnValueOnce({ getAttributeType: () => "string" } as never);
    expect(() => Rules.evaluate(field("name", "eq", null), f.options)).toThrow(expect.objectContaining({ code: "UNSUPPORTED_SURFACE" }));
  });
  it("observes each referenced field once and short-circuits only after complete structural validation", () => {
    const f = setup();
    const repeated = Rules.all([field("name", "eq", null), field("name", "ne", "")]);
    expect(Rules.evaluate(repeated, f.options).state).toBe("matched");
    expect(f.form.form.getAttribute).toHaveBeenCalledOnce();
    expect(f.form.field("name").attribute.getValue).toHaveBeenCalledOnce();
    f.form.form.getAttribute.mockClear();
    f.form.form.getAttribute.mockImplementation(() => { throw new Error("should not observe"); });
    expect(Rules.evaluate(Rules.any([yes, field("name", "eq", null)]), f.options).state).toBe("matched");
    expect(Rules.evaluate(Rules.all([no, field("name", "eq", null)]), f.options).state).toBe("notMatched");
    expect(f.form.form.getAttribute).not.toHaveBeenCalled();
    expect(() => run({ kind: "any", conditions: [yes, { kind: "field", field: "name", op: "gt", value: null }] }, f.options))
      .toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
  });
});

describe("strict complete preflight, limits, accessors and scope/reentry", () => {
  it.each([
    {}, null, false, 0, [], { kind: "all", conditions: [] }, { kind: "any", conditions: [] },
    { kind: "not", condition: undefined }, { ...yes, extra: true },
    { kind: "selection", min: -1, max: 1 }, { kind: "selection", min: 2, max: 1 },
    { kind: "selection", min: 0.5, max: 1 }, { kind: "selection", min: 0, max: 1001 },
    { kind: "selection", min: 0, max: 1, tables: [] },
    { kind: "selection", min: 0, max: 1, tables: ["account", "ACCOUNT"] },
    { kind: "prepared", key: "constructor", op: "eq", value: true },
    { kind: "field", field: "name.path", op: "eq", value: true },
    { kind: "field", field: "name", op: "contains", value: "x" }
  ])("rejects invalid tree %j even behind a decisive branch", condition => {
    const f = setup();
    expect(() => run({ kind: "any", conditions: [yes, condition] }, f.options))
      .toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
    expect(() => Reflect.apply(Rules.all, Rules, [[condition]])).toThrow();
    expect(() => Reflect.apply(Rules.not, Rules, [condition])).toThrow();
    expect(f.read.retrieve).not.toHaveBeenCalled();
    expect(f.form.form.getAttribute).not.toHaveBeenCalled();
  });
  it("enforces branch/node/tree-depth/JSON-depth/UTF-8-byte limits and rejects cycles", () => {
    const f = setup();
    const branches = { kind: "all", conditions: Array.from({ length: 65 }, () => yes) };
    expect(() => run(branches, f.options)).toThrow();
    const many = { kind: "all", conditions: Array.from({ length: 4 }, () => ({
      kind: "all", conditions: Array.from({ length: 64 }, () => yes)
    })) };
    expect(() => run(many, f.options)).toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
    let deep: RuleCondition = yes;
    for (let i = 0; i < 6; i++) deep = { kind: "not", condition: deep };
    expect(Rules.evaluate(deep, f.options).state).toBe("matched");
    deep = { kind: "not", condition: deep };
    expect(() => Rules.evaluate(deep, f.options)).toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
    let jsonDeep: RuleCondition = yes;
    for (let i = 0; i < 5; i++) jsonDeep = { kind: "all", conditions: [jsonDeep] };
    expect(() => Rules.evaluate(jsonDeep, f.options)).toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
    const cycle: Record<string, unknown> = { kind: "not" };
    cycle.condition = cycle;
    expect(() => run(cycle, f.options)).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
    expect(() => run({ ...yes, value: "界".repeat(11_000) }, f.options)).toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
    expect(() => run(" ".repeat(32_769), f.options)).toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
    expect(Rules.evaluate(yes, f.options).state).toBe("matched");
  });
  it("accepts the exact 256-node bound and shared acyclic nodes", () => {
    const f = setup();
    const condition: RuleCondition = { kind: "all", conditions: [
      ...Array.from({ length: 3 }, (): RuleCondition => ({ kind: "all", conditions: Array.from({ length: 64 }, () => yes) })),
      { kind: "all", conditions: Array.from({ length: 59 }, () => yes) }
    ] };
    expect(Rules.evaluate(condition, f.options).state).toBe("matched");
  });
  it.each([
    { allowedFields: ["name", "name"] }, { allowedFields: ["constructor"] },
    { allowedPrepared: [{ key: "flag" }, { key: "flag" }] }, { allowedPrepared: [{ key: "flag", extra: true }] },
    { allowedPrepared: [{ key: "flag", validate: true }] }, { allowedPrepared: [] },
    { extra: true }, { context: {} }, { scope: { invalid: true } }
  ])("rejects non-exact options/allowlists %j", extra => {
    const f = setup();
    expect(() => run(yes, { ...f.options, ...extra })).toThrow();
  });
  it("enforces allowlists over the complete tree and all supplied facts", () => {
    const f = setup();
    expect(() => Rules.evaluate(Rules.any([yes, field("unapproved", "eq", null)]), f.options))
      .toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
    expect(() => Rules.evaluate(Rules.any([yes, { ...missing, key: "unapproved" }]), f.options)).toThrow();
    f.values.unapproved = { state: "notReady" };
    expect(() => Rules.evaluate(yes, f.options)).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
  });
  it("rejects object/array prototype tricks, sparse arrays, symbols and hidden properties without dispatch", () => {
    const f = setup(), attack = vi.fn(() => []);
    class Conditions extends Array { override map = attack; }
    const subclass = new Conditions();
    subclass.push(yes);
    const custom = Object.setPrototypeOf([yes], { map: attack });
    const sparse = [yes, yes, no];
    delete sparse[1];
    const inputs: unknown[] = [
      Object.create(yes), { ...yes, [Symbol("hidden")]: true },
      Object.defineProperty({ ...yes }, "hidden", { value: true }),
      { kind: "all", conditions: sparse },
      { kind: "all", conditions: subclass }, { kind: "all", conditions: custom },
      JSON.parse('{"kind":"prepared","key":"flag","op":"eq","value":true,"__proto__":{}}')
    ];
    for (const input of inputs) expect(() => run(input, f.options)).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
    expect(attack).not.toHaveBeenCalled();
    expect(f.form.form.getAttribute).not.toHaveBeenCalled();
    expect(Rules.evaluate(Object.assign(Object.create(null), yes), f.options).state).toBe("matched");
  });
  it("rejects JSON then/functions without executing untrusted async input methods", async () => {
    const f = setup(), then = vi.fn(() => Promise.reject(new Error("must never run")));
    for (const input of [{ ...yes, then }, { ...yes, value: then }]) {
      expect(() => run(input, f.options)).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
    }
    await Promise.resolve();
    expect(then).not.toHaveBeenCalled();
  });
  it("never invokes input accessors in trees, arrays, options, policies, scopes or facts", () => {
    const f = setup(), getter = vi.fn(() => true);
    const accessor = (key: string, base: object) => Object.defineProperty(base, key, { enumerable: true, get: getter });
    for (const input of [
      accessor("value", { ...yes }),
      { kind: "any", conditions: [yes, accessor("kind", {})] },
      { kind: "all", conditions: accessor("0", [yes]) }
    ]) expect(() => run(input, f.options)).toThrow();
    for (const options of [
      accessor("context", { ...f.options }), { ...f.options, scope: accessor("userId", { ...f.read.scope }) },
      { ...f.options, allowedPrepared: [accessor("validate", { key: "flag" })] },
      { ...f.options, allowedPrepared: accessor("0", [{ key: "flag" }]) },
      { ...f.options, prepared: { scope: f.read.scope, values: { flag: accessor("value", { state: "ready" }) } } }
    ]) expect(() => run(yes, options)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
  it("rejects wrong/expired prepared and declared scopes, offline and malformed native scope", () => {
    const f = setup();
    for (const change of [{ userId: crypto.randomUUID() }, { environmentUrl: "https://other.example" }, { languageId: 1043 }]) {
      expect(() => Rules.evaluate(yes, { ...f.options, scope: { ...f.read.scope, ...change } }))
        .toThrow(expect.objectContaining({ code: "CONFIG_EXPIRED" }));
      expect(() => Rules.evaluate(yes, {
        ...f.options, prepared: { scope: { ...f.read.scope, ...change }, values: f.values }
      })).toThrow(expect.objectContaining({ code: "CONFIG_EXPIRED" }));
    }
    f.read.scope.online = false;
    expect(() => Rules.evaluate(yes, f.options)).toThrow(expect.objectContaining({ code: "UNSUPPORTED_SURFACE" }));
    f.read.scope.online = true; f.read.scope.userId = "bad";
    expect(() => Rules.evaluate(yes, f.options)).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
  });
  it("detects scope changes and invalidation caused by guards or SDK reads, never emits a match", () => {
    for (const mutate of [
      (f: ReturnType<typeof setup>) => { f.read.scope.languageId = 1043; },
      (f: ReturnType<typeof setup>) => { Environment.invalidate(undefined, { context: f.read.context }); }
    ]) {
      const f = setup();
      expect(() => Rules.evaluate(yes, {
        ...f.options, allowedPrepared: [{ key: "flag", validate: () => { mutate(f); return true; } }]
      })).toThrow(expect.objectContaining({ code: "CONFIG_EXPIRED" }));
    }
    const f = setup();
    f.form.field("name").attribute.getValue.mockImplementationOnce(() => {
      f.read.scope.userId = crypto.randomUUID(); return null;
    });
    expect(() => Rules.evaluate(field("name", "eq", null), f.options)).toThrow(expect.objectContaining({ code: "CONFIG_EXPIRED" }));
  });
  it("detects descriptor traps changing scope and does not evaluate mutated source input", () => {
    const f = setup();
    const proxy = new Proxy({ ...yes }, {
      ownKeys: target => { f.read.scope.languageId = 1043; return Reflect.ownKeys(target); }
    });
    expect(() => run(proxy, f.options)).toThrow(expect.objectContaining({ code: "CONFIG_EXPIRED" }));
    expect(f.form.form.getAttribute).not.toHaveBeenCalled();
  });
  it("rejects recursive evaluation, retains the cause and resets its guard after failure", () => {
    const f = setup();
    expect(() => Rules.evaluate(yes, {
      ...f.options, allowedPrepared: [{ key: "flag", validate: () => Rules.evaluate(yes, f.options).state === "matched" }]
    })).toThrow(expect.objectContaining({ code: "CONFIG_VALUE_INVALID", cause: expect.objectContaining({ code: "EVENT_REENTRY" }) }));
    f.form.field("name").attribute.getValue.mockImplementationOnce(() => Rules.evaluate(yes, f.options));
    expect(() => Rules.evaluate(field("name", "eq", null), f.options)).toThrow(expect.objectContaining({ code: "EVENT_REENTRY" }));
    expect(Rules.evaluate(yes, f.options).state).toBe("matched");
  });
  it("uses native scope fallback without any network call and preserves SDK receiver errors", () => {
    const f = setup(), sdk = nativeSdk(), retrieve = vi.fn();
    vi.stubGlobal("Xrm", { ...sdk.xrm, WebApi: { retrieveMultipleRecords: retrieve } });
    const { scopeContext: _context, ...options } = f.options;
    void _context;
    const scope = { ...f.read.scope, userId: sdk.settings.userId };
    expect(Rules.evaluate({ kind: "record", state: "saved" }, {
      ...options, scope, prepared: { scope, values: f.values }
    }).state).toBe("matched");
    expect(retrieve).not.toHaveBeenCalled();
    expect(f.form.form.data.save).not.toHaveBeenCalled();
    vi.stubGlobal("Xrm", undefined);
    expect(() => Rules.evaluate(yes, options)).toThrow(expect.objectContaining({ code: "UNSUPPORTED_SURFACE" }));
    const original = new VbdError("ACCESS_DENIED", { operation: "test.scope" });
    expect(() => Rules.evaluate(yes, { ...f.options, scopeContext: { ...f.read.context, getScope: () => { throw original; } } }))
      .toThrow(original);
  });
});
