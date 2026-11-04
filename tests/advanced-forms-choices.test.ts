import { describe, expect, it, vi } from "vitest";
import { Choices } from "../src/lookups.js";
import type { ChoiceBaselineToken, ChoiceOption } from "../src/lookups.js";
import { Context } from "../src/context.js";
import type { SdkObject } from "../src/sdk.js";
import { VbdError } from "../src/errors.js";

const original: ChoiceOption[] = [
  { value: 0, text: "" }, { value: 2, text: "Two" }, { value: -1, text: "Negative" }
];
function choiceHost(type = "optionset", value: unknown = 0, options = original) {
  const state = {
    type, value, options: options.map(option => ({ ...option })), controlType: type === "optionset" ? "choice" : "choices",
    column: "status", name: "status", bound: [] as SdkObject[],
    resolvedControl: null as SdkObject | null, resolvedAttribute: null as SdkObject | null
  };
  const attribute = {
    getName: vi.fn(function(this: unknown): string { expect(this).toBe(attribute); return state.column; }),
    getAttributeType: vi.fn(function(this: unknown): string { expect(this).toBe(attribute); return state.type; }),
    getValue: vi.fn(function(this: unknown): unknown { expect(this).toBe(attribute); return state.value; }),
    setValue: vi.fn(function(this: unknown, next: unknown): void { expect(this).toBe(attribute); state.value = next; }),
    getOptions: vi.fn(() => original.map(option => ({ ...option }))),
    fireOnChange: vi.fn(),
    controls: { get: vi.fn(function(this: unknown): SdkObject[] {
      expect(this).toBe(attribute.controls); return state.bound;
    }) }
  };
  const control = {
    getName: vi.fn(function(this: unknown): string { expect(this).toBe(control); return state.name; }),
    getControlType: vi.fn(function(this: unknown): string { expect(this).toBe(control); return state.controlType; }),
    getAttribute: vi.fn(function(this: unknown): SdkObject { expect(this).toBe(control); return attribute; }),
    getOptions: vi.fn(function(this: unknown): ChoiceOption[] {
      expect(this).toBe(control); return state.options.map(option => ({ ...option }));
    }),
    clearOptions: vi.fn(function(this: unknown): void { expect(this).toBe(control); state.options = []; }),
    addOption: vi.fn(function(this: unknown, option: ChoiceOption, index: number): void {
      expect(this).toBe(control); state.options.splice(index, 0, { ...option });
    })
  };
  const form = {
    getAttribute: vi.fn(function(this: unknown, column: string): SdkObject | null {
      expect(this).toBe(form); return column === "status" ? state.resolvedAttribute : null;
    }),
    getControl: vi.fn(function(this: unknown, name: string): SdkObject | null {
      expect(this).toBe(form); return name === "status" ? state.resolvedControl : null;
    }),
    data: { entity: {}, save: vi.fn() }, ui: {}
  };
  state.bound = [control]; state.resolvedControl = control; state.resolvedAttribute = attribute;
  return { state, form, attribute, control };
}
function unsafeSet(host: ReturnType<typeof choiceHost>, options: unknown, settings: unknown = {}) {
  return Reflect.apply(Choices.setOptions, undefined, [host.form, "status", options, settings]);
}
function failure(run: () => unknown): VbdError {
  try { run(); }
  catch (error) {
    if (error instanceof VbdError) return error;
    throw error;
  }
  throw new Error("Expected a VbdError.");
}

describe("R2 native display options and exact baselines", () => {
  it("binds native receivers, uses native control baseline, supports zero/empty labels and exact order", () => {
    const host = choiceHost();
    const context = Context.fromFormCommand(host.form);
    const baseline = host.state.options.map(option => ({ ...option }));
    const change = Choices.setOptions(context, "status", [{ value: -1, text: "" }, { value: 0, text: "Zero" }]);
    expect(change).toMatchObject({ status: "applied", clearedValues: [] });
    expect(Object.isFrozen(change.baseline)).toBe(true);
    expect(host.state.options).toEqual([{ value: -1, text: "" }, { value: 0, text: "Zero" }]);
    expect(host.control.addOption).toHaveBeenNthCalledWith(1, { value: -1, text: "" }, 0);
    expect(host.control.addOption).toHaveBeenNthCalledWith(2, { value: 0, text: "Zero" }, 1);
    expect(Choices.restoreOptions(context, "status", change.baseline)).toEqual({ status: "restored", clearedValues: [] });
    expect(host.state.options).toEqual(baseline);
    expect(host.attribute.getOptions).not.toHaveBeenCalled();
    expect(host.attribute.setValue).not.toHaveBeenCalled();
    expect(host.attribute.fireOnChange).not.toHaveBeenCalled();
    expect(host.form.data.save).not.toHaveBeenCalled();
  });

  it("keeps existing attribute-based getOptions unchanged", () => {
    const host = choiceHost();
    host.state.options = [{ value: 0, text: "Control only" }];
    expect(Choices.getOptions(host.form, "status")).toEqual(original);
    expect(host.control.getOptions).not.toHaveBeenCalled();
  });

  it("filters in native order, not caller value order, and snapshots already filtered native content", () => {
    const host = choiceHost("optionset", null, [original[2]!, original[0]!]);
    const result = Choices.filterOptions(host.form, "status", [0, -1]);
    expect(host.state.options).toEqual([original[2], original[0]]);
    Choices.restoreOptions(host.form, "status", result.baseline);
    expect(host.state.options).toEqual([original[2], original[0]]);
  });

  it.each([
    null, false, {}, [{ value: "0", text: "x" }], [{ value: 1.5, text: "x" }],
    [{ value: Infinity, text: "x" }], [{ value: NaN, text: "x" }],
    [{ value: 2147483648, text: "x" }], [{ value: -2147483649, text: "x" }],
    [{ value: null, text: "" }], [{ value: false, text: "" }], [{ value: 0, text: false }],
    [{ value: 0, text: null }], [{ value: 0 }], [{ value: 0, text: "x", index: 1 }],
    [{ value: 0, text: "x".repeat(8193) }], [{ value: 0, text: "" }, { value: 0, text: "Again" }],
    [{ value: 99, text: "Not native" }]
  ].map(options => ({ options })))("rejects malformed, duplicate or unknown display identities before all writes: %j", ({ options }) => {
    const host = choiceHost();
    expect(() => unsafeSet(host, options)).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
    expect(host.control.clearOptions).not.toHaveBeenCalled();
    expect(host.attribute.setValue).not.toHaveBeenCalled();
  });

  it("accepts Int32 and label/count boundaries, rejects 1001 options before writes", () => {
    const options = Array.from({ length: 1000 }, (_, value) => ({ value, text: "" }));
    options[0] = { value: -2147483648, text: "x".repeat(8192) };
    options[999] = { value: 2147483647, text: "" };
    const host = choiceHost("optionset", null, options);
    Choices.setOptions(host.form, "status", options);
    expect(host.state.options).toEqual(options);
    host.control.clearOptions.mockClear();
    expect(() => Choices.setOptions(host.form, "status", [...options, { value: 1001, text: "" }])).toThrow();
    expect(host.control.clearOptions).not.toHaveBeenCalled();
  });

  it.each([null, false, [0, 0], ["0"], [false], [1.5], [99], Array.from({ length: 1001 }, (_, i) => i)]
    .map(values => ({ values })))(
    "validates filter identities without coercion: %j", ({ values }) => {
      const host = choiceHost();
      expect(() => Reflect.apply(Choices.filterOptions, undefined, [host.form, "status", values]))
        .toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
      expect(host.control.clearOptions).not.toHaveBeenCalled();
    });

  it.each([["optionset", null], ["multiselectoptionset", null], ["multiselectoptionset", []]])(
    "permits empty options for %s / %j", (type, value) => {
      const host = choiceHost(String(type), value);
      const result = Choices.filterOptions(host.form, "status", []);
      expect(host.state.options).toEqual([]);
      expect(host.attribute.setValue).not.toHaveBeenCalled();
      Choices.restoreOptions(host.form, "status", result.baseline);
      expect(host.state.options).toEqual(original);
    });

  it.each([["optionset", 0], ["multiselectoptionset", [2, 0]]])(
    "rejects excluded selections by default and clears only excluded values explicitly: %s", (type, value) => {
      const host = choiceHost(String(type), value);
      expect(() => Choices.filterOptions(host.form, "status", [2]))
        .toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT", cause: { excludedValues: [0] } }));
      expect(host.control.clearOptions).not.toHaveBeenCalled();
      const change = Choices.filterOptions(host.form, "status", [2], { excludedValuePolicy: "clear" });
      expect(change.clearedValues).toEqual([0]);
      expect(host.state.value).toEqual(type === "optionset" ? null : [2]);
      expect(host.attribute.setValue).toHaveBeenCalledExactlyOnceWith(type === "optionset" ? null : [2]);
      Choices.restoreOptions(host.form, "status", change.baseline);
      expect(host.state.value).toEqual(type === "optionset" ? null : [2]);
      expect(host.attribute.setValue).toHaveBeenCalledOnce();
    });

  it.each([["optionset", 0, null], ["multiselectoptionset", [0, 2], []]])(
    "setOptions explicitly clears an entirely excluded %s selection, not implicitly", (type, value, cleared) => {
      const host = choiceHost(String(type), value);
      expect(() => Choices.setOptions(host.form, "status", [])).toThrow();
      expect(host.control.clearOptions).not.toHaveBeenCalled();
      const result = Choices.setOptions(host.form, "status", [], { excludedValuePolicy: "clear" });
      expect(result.clearedValues).toEqual(type === "optionset" ? [0] : [0, 2]);
      expect(host.state.value).toEqual(cleared);
      Choices.restoreOptions(host.form, "status", result.baseline);
      expect(host.state.value).toEqual(cleared);
    });

  it.each([false, "", 1.5, [], [0], undefined].map(value => ({ value })))("rejects invalid single-choice native values: %j", ({ value }) => {
    const host = choiceHost(); host.state.value = value;
    expect(() => Choices.setOptions(host.form, "status", original))
      .toThrow(expect.objectContaining({ code: "DATA_RESPONSE_INVALID" }));
    expect(host.control.clearOptions).not.toHaveBeenCalled();
  });

  it.each([false, 0, [0, 0], [false], [1.5], [2147483648]].map(value => ({ value })))("rejects invalid multi-choice native values: %j", ({ value }) => {
    const host = choiceHost("multiselectoptionset", value);
    expect(() => Choices.setOptions(host.form, "status", original))
      .toThrow(expect.objectContaining({ code: "DATA_RESPONSE_INVALID" }));
    expect(host.control.clearOptions).not.toHaveBeenCalled();
  });

  it.each([{ excludedValuePolicy: "preserve" }, { excludedValuePolicy: "report" }, { scope: "attribute" }, { fireOnChange: true }])(
    "rejects unsupported policies/scopes: %j", settings => {
      const host = choiceHost();
      expect(() => unsafeSet(host, original, settings)).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
      expect(host.control.clearOptions).not.toHaveBeenCalled();
    });

  it.each(["type", "controlType", "multiple", "unbound", "attribute", "missing", "name", "column", "capability"])(
    "preflights actual bound choice context and all capabilities: %s", scenario => {
      const host = choiceHost();
      if (scenario === "type") host.state.type = "boolean";
      if (scenario === "controlType") host.state.controlType = "customcontrol:fixture";
      if (scenario === "multiple") host.state.bound.push({});
      if (scenario === "unbound") host.state.bound = [];
      if (scenario === "attribute") host.state.resolvedAttribute = {};
      if (scenario === "missing") host.state.resolvedControl = null;
      if (scenario === "name") host.state.name = "renamed";
      if (scenario === "column") host.state.column = "renamed";
      if (scenario === "capability") Reflect.deleteProperty(host.control, "addOption");
      expect(() => Choices.setOptions(host.form, "status", original)).toThrow();
      expect(host.control.clearOptions).not.toHaveBeenCalled();
    });

  it("requires a real supplied context, not a copied OperationContext or execution context", () => {
    const host = choiceHost();
    const context = Context.fromFormCommand(host.form);
    for (const input of [{ ...context }, { getFormContext: () => host.form }, undefined]) {
      expect(() => Choices.setOptions(input, "status", original)).toThrow();
    }
    expect(host.control.clearOptions).not.toHaveBeenCalled();
  });

  it.each([
    [{ value: 0, text: "" }, { value: 0, text: "Duplicate" }],
    [{ value: null, text: "" }], [{ value: "0", text: "" }], [{ value: 0, text: false }]
  ].map(options => ({ options })))("does not guess or coerce malformed native baseline options: %j", ({ options }) => {
    const host = choiceHost();
    host.control.getOptions.mockImplementation(() => options as unknown as ChoiceOption[]);
    expect(() => Choices.setOptions(host.form, "status", []))
      .toThrow(expect.objectContaining({ code: "DATA_RESPONSE_INVALID" }));
    expect(host.control.clearOptions).not.toHaveBeenCalled();
  });

  it("rejects forged/cross-control/copied/consumed tokens without changing native options", () => {
    const host = choiceHost(), other = choiceHost();
    const token = Choices.filterOptions(host.form, "status", [0]).baseline;
    host.control.clearOptions.mockClear();
    for (const forged of [{}, { ...token }, null, "token"]) {
      expect(() => Reflect.apply(Choices.restoreOptions, undefined, [host.form, "status", forged]))
        .toThrow(expect.objectContaining({ code: "RESOURCE_NOT_FOUND" }));
    }
    expect(() => Choices.restoreOptions(other.form, "status", token)).toThrow();
    expect(host.control.clearOptions).not.toHaveBeenCalled();
    Choices.restoreOptions(host.form, "status", token);
    expect(() => Choices.restoreOptions(host.form, "status", token)).toThrow();
  });

  it("has one active token per control, invalidates older writers, and preserves a token on failed preflight", () => {
    const host = choiceHost();
    const older = Choices.setOptions(host.form, "status", original).baseline;
    const newer = Choices.filterOptions(host.form, "status", [0, 2]).baseline;
    expect(() => Choices.restoreOptions(host.form, "status", older)).toThrow();
    expect(() => Choices.filterOptions(host.form, "status", [2])).toThrow();
    Choices.restoreOptions(host.form, "status", newer);
    expect(host.state.options).toEqual(original);
    expect(() => Choices.restoreOptions(host.form, "status", older)).toThrow();
  });

  it.each(["content", "order", "label", "method", "control", "attribute", "form", "type", "bound", "collection", "data", "ui"])(
    "rejects native drift, replacement or reconfiguration before restoring: %s", scenario => {
      const host = choiceHost();
      const token = Choices.setOptions(host.form, "status", original).baseline;
      let form: unknown = host.form;
      if (scenario === "content") host.state.options.pop();
      if (scenario === "order") host.state.options.reverse();
      if (scenario === "label") host.state.options[0]!.text = "Other writer";
      if (scenario === "method") host.control.addOption = vi.fn();
      if (scenario === "control") host.state.resolvedControl = choiceHost().control;
      if (scenario === "attribute") host.state.resolvedAttribute = {};
      if (scenario === "form") form = { ...host.form };
      if (scenario === "type") { host.state.type = "multiselectoptionset"; host.state.controlType = "choices"; }
      if (scenario === "bound") host.state.bound.push({});
      if (scenario === "collection") host.attribute.controls = { ...host.attribute.controls };
      if (scenario === "data") host.form.data = { ...host.form.data };
      if (scenario === "ui") host.form.ui = {};
      host.control.clearOptions.mockClear();
      expect(() => Choices.restoreOptions(form, "status", token)).toThrow();
      expect(host.control.clearOptions).not.toHaveBeenCalled();
    });

  it("restore checks current selections independently, with explicit clear but no resurrection of old values", () => {
    const host = choiceHost("multiselectoptionset", [0, 2]);
    const token = Choices.filterOptions(host.form, "status", [0, 2]).baseline;
    host.state.value = [99, 2];
    host.control.clearOptions.mockClear();
    expect(() => Choices.restoreOptions(host.form, "status", token)).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
    expect(host.control.clearOptions).not.toHaveBeenCalled();
    expect(Choices.restoreOptions(host.form, "status", token, { excludedValuePolicy: "clear" }).clearedValues).toEqual([99]);
    expect(host.state.value).toEqual([2]);
    expect(host.state.options).toEqual(original);
  });

  it("restore applies the same reject/clear policy to single-choice selections introduced later", () => {
    const host = choiceHost();
    const token = Choices.filterOptions(host.form, "status", [0]).baseline;
    host.state.value = 99;
    expect(() => Choices.restoreOptions(host.form, "status", token)).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
    expect(Choices.restoreOptions(host.form, "status", token, { excludedValuePolicy: "clear" }).clearedValues).toEqual([99]);
    expect(host.state.value).toBeNull();
    expect(host.state.options).toEqual(original);
  });

  it("invalid restore settings leave the valid token and native options untouched", () => {
    const host = choiceHost();
    const token = Choices.filterOptions(host.form, "status", [0]).baseline;
    host.control.clearOptions.mockClear();
    expect(() => Reflect.apply(Choices.restoreOptions, undefined,
      [host.form, "status", token, { excludedValuePolicy: "preserve" }])).toThrow();
    expect(host.control.clearOptions).not.toHaveBeenCalled();
    expect(Choices.restoreOptions(host.form, "status", token).status).toBe("restored");
  });

  it("preflights the value setter before the first option mutation", () => {
    const host = choiceHost();
    Reflect.deleteProperty(host.attribute, "setValue");
    expect(() => Choices.filterOptions(host.form, "status", [], { excludedValuePolicy: "clear" }))
      .toThrow(expect.objectContaining({ code: "UNSUPPORTED_SURFACE" }));
    expect(host.control.clearOptions).not.toHaveBeenCalled();
  });

  it.each(["clear", "add", "value", "silentOptions"])(
    "reports partial/uncertain native writes and retains baseline and completed progress: %s", scenario => {
      const host = choiceHost();
      if (scenario === "clear") host.control.clearOptions.mockImplementation(() => {
        host.state.options = []; throw new Error("CLEAR_CANARY");
      });
      if (scenario === "add") host.control.addOption.mockImplementationOnce((option, index) => {
        host.state.options.splice(index, 0, option); throw new Error("ADD_CANARY");
      });
      if (scenario === "value") host.attribute.setValue.mockImplementation(next => {
        host.state.value = next; throw new Error("VALUE_CANARY");
      });
      if (scenario === "silentOptions") host.control.addOption.mockImplementation(() => {});
      const error = failure(() => Choices.filterOptions(host.form, "status", [2], { excludedValuePolicy: "clear" }));
      expect(error.code).toBe("PARTIAL_FAILURE");
      expect(error.cause).toMatchObject({ baselineOptions: original, outcome: "uncertain", completed: expect.any(Array) });
      const cause = error.cause as { baseline: ChoiceBaselineToken; completed: string[] };
      if (scenario === "clear") expect(cause.completed).toEqual([]);
      if (scenario === "add") expect(cause.completed).toEqual(["clearOptions"]);
      if (scenario === "value") expect(cause.completed).toEqual(["clearOptions", "addOption.0"]);
      expect(() => Choices.restoreOptions(host.form, "status", cause.baseline))
        .toThrow(expect.objectContaining({ code: "RESOURCE_CONFLICT" }));
    });

  it("detects an implicit native value clear even without an explicit value policy", () => {
    const host = choiceHost();
    host.control.clearOptions.mockImplementation(() => { host.state.options = []; host.state.value = null; });
    expect(() => Choices.setOptions(host.form, "status", original))
      .toThrow(expect.objectContaining({ code: "PARTIAL_FAILURE" }));
    expect(host.attribute.setValue).not.toHaveBeenCalled();
  });

  it("does not let a native setter mutate the intended multi-value verification snapshot", () => {
    const host = choiceHost("multiselectoptionset", [0, 2]);
    host.attribute.setValue.mockImplementation(next => {
      if (Array.isArray(next)) next.length = 0;
      host.state.value = next;
    });
    const error = failure(() => Choices.filterOptions(host.form, "status", [2], { excludedValuePolicy: "clear" }));
    expect(error).toMatchObject({
      code: "PARTIAL_FAILURE", cause: { beforeValue: [0, 2], intendedValue: [2], attempted: "verify" }
    });
    expect(host.state.value).toEqual([]);
  });

  it.each(["control", "method", "collection", "formData"])(
    "reports partial failure rather than success when a setter replaces/reconfigures the native target: %s", scenario => {
      const host = choiceHost();
      host.control.addOption.mockImplementation((option, index) => {
        host.state.options.splice(index, 0, { ...option });
        if (scenario === "control") host.state.resolvedControl = choiceHost().control;
        if (scenario === "method") host.attribute.getValue = vi.fn(() => host.state.value);
        if (scenario === "collection") host.attribute.controls = { ...host.attribute.controls };
        if (scenario === "formData") host.form.data = { ...host.form.data };
      });
      expect(() => Choices.setOptions(host.form, "status", original))
        .toThrow(expect.objectContaining({ code: "PARTIAL_FAILURE" }));
    });

  it("retains a restore failure baseline and never pretends rollback succeeded", () => {
    const host = choiceHost();
    const token = Choices.filterOptions(host.form, "status", [0]).baseline;
    host.control.addOption.mockImplementationOnce(() => { throw new Error("RESTORE_CANARY"); });
    const error = failure(() => Choices.restoreOptions(host.form, "status", token));
    expect(error).toMatchObject({ code: "PARTIAL_FAILURE", cause: { baseline: token, baselineOptions: original } });
    expect(host.state.options).toEqual([]);
    expect(() => Choices.restoreOptions(host.form, "status", token)).toThrow();
  });

  it("blocks native setter reentry and releases the guard after failure", () => {
    const host = choiceHost();
    host.control.clearOptions.mockImplementationOnce(() => {
      Choices.filterOptions(host.form, "status", [0]);
    });
    expect(failure(() => Choices.setOptions(host.form, "status", original)))
      .toMatchObject({ code: "PARTIAL_FAILURE", cause: { cause: { code: "RESOURCE_BUSY" } } });
    expect(Choices.setOptions(host.form, "status", original).status).toBe("applied");
  });
});
