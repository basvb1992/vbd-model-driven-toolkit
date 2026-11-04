import { z } from "zod";
import { formOf } from "./context.js";
import { VbdError } from "./errors.js";
import { call, collectionItems, nameSchema, requireMethod, resultOf, sdkObject } from "./sdk.js";
import type { SdkObject } from "./sdk.js";
import { logicalNameSchema, parseInput } from "./validation.js";

const identity = z.number().int().min(-2147483648).max(2147483647);
const optionSchema = z.object({ value: identity, text: z.string().max(8192) }).strict();
const optionsSchema = z.array(optionSchema).max(1000)
  .refine(options => new Set(options.map(option => option.value)).size === options.length);
const valuesSchema = z.array(identity).max(1000)
  .refine(values => new Set(values).size === values.length);
const settingsSchema = z.object({ excludedValuePolicy: z.enum(["reject", "clear"]).default("reject") }).strict();

export interface ChoiceOption { value: number; text: string }
export interface ChoiceMutationOptions { excludedValuePolicy?: "reject" | "clear" }
declare const baselineBrand: unique symbol;
export interface ChoiceBaselineToken { readonly [baselineBrand]: true }
export interface ChoiceMutationResult {
  status: "applied";
  baseline: ChoiceBaselineToken;
  clearedValues: number[];
}
export interface ChoiceRestoreResult { status: "restored"; clearedValues: number[] }

interface Target {
  form: SdkObject;
  control: SdkObject;
  attribute: SdkObject;
  name: string;
  column: string;
  type: "optionset" | "multiselectoptionset";
}
interface OwnedBaseline {
  target: Target;
  token: ChoiceBaselineToken;
  baseline: ChoiceOption[];
  expected: ChoiceOption[] | undefined;
  methods: readonly unknown[];
}
// One active baseline per weakly held control; a retained token does not root its host.
const active = new WeakMap<SdkObject, OwnedBaseline>();
const tokens = new WeakMap<ChoiceBaselineToken, WeakRef<SdkObject>>();
const busy = new WeakSet<SdkObject>();
const controlMethods = ["getName", "getControlType", "getAttribute", "getOptions", "clearOptions", "addOption"] as const;
const attributeMethods = ["getName", "getAttributeType", "getValue", "setValue"] as const;
function fingerprints(target: Target): unknown[] {
  return [
    ...controlMethods.map(name => target.control[name]),
    ...attributeMethods.map(name => target.attribute[name]),
    target.attribute.controls, sdkObject(target.attribute.controls).get,
    target.form.getControl, target.form.getAttribute, target.form.data, target.form.ui,
    sdkObject(target.form.data).entity
  ];
}
function sameTarget(target: Target, original: Target, methods: readonly unknown[]): boolean {
  return target.form === original.form && target.control === original.control &&
    target.attribute === original.attribute && target.name === original.name &&
    target.column === original.column && target.type === original.type &&
    fingerprints(target).every((method, index) => method === methods[index]);
}
function targetOf(form: SdkObject, control: SdkObject, name: string): Target {
  if (resultOf(nameSchema, call(control, "getName")) !== name) {
    throw new VbdError("RESOURCE_NOT_FOUND", { operation: "choices.target" });
  }
  const controlType = resultOf(z.string(), call(control, "getControlType"));
  const attribute = sdkObject(call(control, "getAttribute"));
  const type = resultOf(z.string(), call(attribute, "getAttributeType"));
  if ((type !== "optionset" && type !== "multiselectoptionset") ||
      controlType !== (type === "optionset" ? "choice" : "choices")) {
    throw new VbdError("FIELD_TYPE_MISMATCH", { operation: "choices.target" });
  }
  const column = resultOf(logicalNameSchema, call(attribute, "getName"));
  if (call(form, "getAttribute", column) !== attribute) {
    throw new VbdError("RESOURCE_NOT_FOUND", { operation: "choices.target" });
  }
  const bound = collectionItems(attribute.controls, 100);
  if (bound.length !== 1 || bound[0] !== control) {
    throw new VbdError("UNSUPPORTED_SURFACE", { operation: "choices.scope" });
  }
  for (const method of controlMethods) requireMethod(control, method);
  return { form, control, attribute, name, column, type };
}
function nativeOptions(target: Target): ChoiceOption[] {
  return resultOf(optionsSchema, call(target.control, "getOptions"));
}
function nativeValue(target: Target): number | number[] | null {
  return resultOf(target.type === "optionset" ? identity.nullable() : valuesSchema.nullable(),
    call(target.attribute, "getValue"));
}
function sameOptions(left: readonly ChoiceOption[], right: readonly ChoiceOption[]): boolean {
  return left.length === right.length && left.every((item, index) =>
    item.value === right[index]?.value && item.text === right[index]?.text);
}
function selected(value: number | number[] | null): number[] {
  return value === null ? [] : typeof value === "number" ? [value] : value;
}
function withTarget<T>(input: unknown, name: string, run: (target: Target) => T): T {
  parseInput(nameSchema, name, "choices.target");
  const form = formOf(input), raw = call(form, "getControl", name);
  if (raw === null || raw === undefined) {
    throw new VbdError("FORM_TARGET_MISSING", { operation: "choices.target" });
  }
  const control = sdkObject(raw);
  if (busy.has(control)) throw new VbdError("RESOURCE_BUSY", { operation: "choices.options" });
  busy.add(control);
  try { return run(targetOf(form, control, name)); }
  finally { busy.delete(control); }
}
function apply(target: Target, before: ChoiceOption[], desired: ChoiceOption[],
  settings: ChoiceMutationOptions, owned?: OwnedBaseline): { baseline: ChoiceBaselineToken; clearedValues: number[] } {
  const policy = parseInput(settingsSchema, settings, "choices.options");
  const value = nativeValue(target);
  const clearedValues = selected(value).filter(value => !desired.some(option => option.value === value));
  if (clearedValues.length > 0 && policy.excludedValuePolicy === "reject") {
    throw new VbdError("INVALID_ARGUMENT", { operation: "choices.selection", cause: { excludedValues: clearedValues } });
  }
  if (clearedValues.length > 0) requireMethod(target.attribute, "setValue");
  const nextValue = clearedValues.length === 0 ? value : target.type === "optionset" ? null :
    selected(value).filter(value => !clearedValues.includes(value));
  const token = owned?.token ?? Object.freeze({}) as ChoiceBaselineToken;
  const state: OwnedBaseline = owned ?? {
    target, token, baseline: before, expected: before, methods: fingerprints(target)
  };
  // Capture before the first attempted setter, including setters which mutate then throw.
  const previous = active.get(target.control);
  if (previous && previous.token !== token) tokens.delete(previous.token);
  active.set(target.control, state);
  tokens.set(token, new WeakRef(target.control));
  const completed: string[] = [];
  let attempted = "clearOptions";
  try {
    call(target.control, "clearOptions");
    completed.push("clearOptions");
    for (const [index, option] of desired.entries()) {
      attempted = `addOption.${index}`;
      call(target.control, "addOption", { ...option }, index);
      completed.push(attempted);
    }
    if (clearedValues.length > 0) {
      attempted = "setValue";
      call(target.attribute, "setValue", Array.isArray(nextValue) ? [...nextValue] : nextValue);
      completed.push(attempted);
    }
    attempted = "verify";
    const current = targetOf(formOf(target.form),
      sdkObject(call(target.form, "getControl", target.name)), target.name);
    if (!sameTarget(current, state.target, state.methods)) {
      throw new VbdError("RESOURCE_NOT_FOUND", { operation: "choices.verify" });
    }
    if (!sameOptions(nativeOptions(target), desired) ||
        JSON.stringify(nativeValue(target)) !== JSON.stringify(nextValue)) {
      throw new VbdError("DATA_RESPONSE_INVALID", { operation: "choices.verify" });
    }
    state.expected = desired;
  } catch (cause) {
    state.expected = undefined;
    throw new VbdError("PARTIAL_FAILURE", {
      operation: "choices.options",
      cause: { baseline: token, baselineOptions: state.baseline.map(option => ({ ...option })),
        beforeOptions: before.map(option => ({ ...option })), intendedOptions: desired.map(option => ({ ...option })),
        beforeValue: Array.isArray(value) ? [...value] : value,
        intendedValue: Array.isArray(nextValue) ? [...nextValue] : nextValue,
        completed, attempted, outcome: "uncertain", cause }
    });
  }
  return { baseline: token, clearedValues };
}
export function setOptions(input: unknown, controlName: string, options: readonly ChoiceOption[],
  settings: ChoiceMutationOptions = {}): ChoiceMutationResult {
  const desired = parseInput(optionsSchema, options, "choices.setOptions");
  parseInput(settingsSchema, settings, "choices.setOptions");
  return withTarget(input, controlName, target => {
    const before = nativeOptions(target);
    if (desired.some(option => !before.some(existing => existing.value === option.value))) {
      throw new VbdError("INVALID_ARGUMENT", { operation: "choices.identity" });
    }
    return { status: "applied", ...apply(target, before, desired, settings) };
  });
}
export function filterOptions(input: unknown, controlName: string, allowedValues: readonly number[],
  settings: ChoiceMutationOptions = {}): ChoiceMutationResult {
  const allowed = parseInput(valuesSchema, allowedValues, "choices.filterOptions");
  parseInput(settingsSchema, settings, "choices.filterOptions");
  return withTarget(input, controlName, target => {
    const before = nativeOptions(target);
    if (allowed.some(value => !before.some(option => option.value === value))) {
      throw new VbdError("INVALID_ARGUMENT", { operation: "choices.identity" });
    }
    const desired = before.filter(option => allowed.includes(option.value));
    return { status: "applied", ...apply(target, before, desired, settings) };
  });
}
export function restoreOptions(input: unknown, controlName: string, token: ChoiceBaselineToken,
  settings: ChoiceMutationOptions = {}): ChoiceRestoreResult {
  parseInput(settingsSchema, settings, "choices.restoreOptions");
  const original = tokens.get(token)?.deref();
  if (!original) throw new VbdError("RESOURCE_NOT_FOUND", { operation: "choices.restoreOptions" });
  return withTarget(input, controlName, target => {
    const state = active.get(original);
    if (target.control !== original || !state || state.token !== token) {
      throw new VbdError("RESOURCE_NOT_FOUND", { operation: "choices.restoreOptions" });
    }
    if (!sameTarget(target, state.target, state.methods)) {
      throw new VbdError("RESOURCE_NOT_FOUND", { operation: "choices.restoreOptions" });
    }
    const before = nativeOptions(target);
    if (state.expected === undefined || !sameOptions(before, state.expected)) {
      throw new VbdError("RESOURCE_CONFLICT", { operation: "choices.restoreOptions" });
    }
    const result = apply(target, before, state.baseline, settings, state);
    active.delete(original);
    tokens.delete(token);
    return { status: "restored", clearedValues: result.clearedValues };
  });
}
