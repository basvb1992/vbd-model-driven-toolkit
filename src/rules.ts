import { z } from "zod";
import { assertRuntimeStructure, copyRuntimeJson, runtimePredicate, runtimeSnapshot } from "./configuration-values.js";
import { Context, formOf } from "./context.js";
import type { OperationContext } from "./context.js";
import { plain, safeKey } from "./data-core.js";
import { VbdError } from "./errors.js";
import { contextSchema, readScope, scopeKey } from "./platform.js";
import type { ReadContext, ReadScope } from "./platform.js";
import { call, resultOf } from "./sdk.js";
import { identifierSchema, logicalNameSchema, parseInput } from "./validation.js";

export type RuleScalar = string | number | boolean | null;
export type RuleComparison =
  | { readonly op: "eq" | "ne"; readonly value: RuleScalar }
  | { readonly op: "lt" | "lte" | "gt" | "gte"; readonly value: number };
export interface RuleAll { readonly kind: "all"; readonly conditions: readonly RuleCondition[] }
export interface RuleAny { readonly kind: "any"; readonly conditions: readonly RuleCondition[] }
export interface RuleNot { readonly kind: "not"; readonly condition: RuleCondition }
export type RuleCondition =
  | RuleAll | RuleAny | RuleNot
  | { readonly kind: "record"; readonly state: "saved" | "unsaved" }
  | { readonly kind: "selection"; readonly min: number; readonly max: number; readonly tables?: readonly string[] }
  | { readonly kind: "capability"; readonly name: "form" | "grid" }
  | ({ readonly kind: "field"; readonly field: string } & RuleComparison)
  | ({ readonly kind: "prepared"; readonly key: string } & RuleComparison);

/** Current-scope caller input, never security/privilege evidence. */
export type RulePreparedFact =
  | { readonly state: "ready"; readonly value: RuleScalar }
  | { readonly state: "notReady" };
export interface RulePreparedValues {
  readonly scope: Readonly<ReadScope>;
  readonly values: Readonly<Record<string, RulePreparedFact>>;
}
export interface RulePreparedPolicy {
  readonly key: string;
  /** Validation only: must return exactly true synchronously, not compute a condition. */
  readonly validate?: (value: unknown) => boolean;
}
export interface RuleEvaluationOptions {
  readonly context: OperationContext;
  /** Explicit current scope. Offline evaluation is not supported by shared read-scope helpers. */
  readonly scope: Readonly<ReadScope>;
  /** Optional trusted scope adapter; only getScope is called. Native fallback never retrieves rows. */
  readonly scopeContext?: ReadContext;
  readonly allowedFields: readonly string[];
  readonly allowedPrepared: readonly RulePreparedPolicy[];
  readonly prepared?: RulePreparedValues;
}
export type RuleState = "matched" | "notMatched" | "unknown";
export type RuleReason =
  | "comparison-satisfied" | "comparison-not-satisfied" | "comparison-type-mismatch"
  | "record-state-satisfied" | "record-state-not-satisfied" | "record-unavailable"
  | "selection-satisfied" | "selection-not-satisfied" | "selection-surface-unavailable"
  | "capability-available" | "capability-unavailable"
  | "field-not-loaded" | "field-surface-unavailable"
  | "prepared-missing" | "prepared-not-ready"
  | "all-satisfied" | "all-not-matched" | "all-unknown"
  | "any-satisfied" | "any-not-matched" | "any-unknown"
  | "negated-match" | "negated-no-match" | "negated-unknown";
export interface RuleAssessment {
  readonly state: RuleState;
  readonly reason: RuleReason;
  readonly basis: "ux-only";
  /** Only evaluated children, in declaration order. No raw field values or scope identities. */
  readonly children: readonly RuleAssessment[];
}

const maxBytes = 32_768, maxNodes = 256, maxDepth = 6;
const scalarSchema = z.union([z.string().max(32_768), z.number().finite(), z.boolean(), z.null()]);
const keySchema = identifierSchema.refine(safeKey);
const fieldSchema = logicalNameSchema.refine(safeKey);
const tableSchema = logicalNameSchema.transform(value => value.toLowerCase());
const fieldsSchema = z.array(fieldSchema).max(100).refine(values => new Set(values).size === values.length);
const equalShape = { op: z.enum(["eq", "ne"]), value: scalarSchema };
const orderedShape = { op: z.enum(["lt", "lte", "gt", "gte"]), value: z.number().finite() };
const nodeSchema: z.ZodType<RuleCondition> = z.lazy(() => z.union([
  z.object({ kind: z.literal("all"), conditions: z.array(nodeSchema).min(1).max(64) }).strict(),
  z.object({ kind: z.literal("any"), conditions: z.array(nodeSchema).min(1).max(64) }).strict(),
  z.object({ kind: z.literal("not"), condition: nodeSchema }).strict(),
  z.object({ kind: z.literal("record"), state: z.enum(["saved", "unsaved"]) }).strict(),
  z.object({
    kind: z.literal("selection"), min: z.number().int().min(0).max(1000),
    max: z.number().int().min(0).max(1000),
    tables: z.array(tableSchema).min(1).max(100)
      .refine(values => new Set(values).size === values.length).optional()
  }).strict().refine(value => value.min <= value.max)
    .transform(({ tables, ...rest }) => tables === undefined ? rest : { ...rest, tables }),
  z.object({ kind: z.literal("capability"), name: z.enum(["form", "grid"]) }).strict(),
  z.object({
    kind: z.literal("field"), field: fieldSchema,
    ...equalShape
  }).strict(),
  z.object({ kind: z.literal("field"), field: fieldSchema, ...orderedShape }).strict(),
  z.object({
    kind: z.literal("prepared"), key: keySchema,
    ...equalShape
  }).strict(),
  z.object({ kind: z.literal("prepared"), key: keySchema, ...orderedShape }).strict()
]));
const factSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ready"), value: scalarSchema }).strict(),
  z.object({ state: z.literal("notReady") }).strict()
]);
const preparedSchema = z.object({
  scope: z.unknown(), values: z.record(keySchema, factSchema)
}).strict();
const policySchema = z.object({
  key: keySchema, validate: z.custom<(value: unknown) => boolean>(value => typeof value === "function").optional()
}).strict();
const optionsSchema = z.object({
  context: z.custom<OperationContext>(value => typeof value === "object" && value !== null),
  scope: z.unknown(), scopeContext: contextSchema.optional(),
  allowedFields: fieldsSchema, allowedPrepared: z.array(policySchema).max(100)
    .refine(values => new Set(values.map(value => value.key)).size === values.length),
  prepared: preparedSchema.optional()
}).strict();

function fail(code: "INVALID_ARGUMENT" | "LIMIT_EXCEEDED" | "CONFIG_EXPIRED" | "EVENT_REENTRY" = "INVALID_ARGUMENT"): never {
  throw new VbdError(code, { operation: "rules.evaluate" });
}

/** Opaque SDK contexts and trusted callbacks are not JSON; inspect their containing records first. */
function dataRecord(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!plain(input)) return fail();
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !safeKey(key) || !allowed.includes(key)) return fail();
    const property = Object.getOwnPropertyDescriptor(input, key);
    if (!property || !("value" in property) || !property.enumerable) return fail();
    result[key] = property.value;
  }
  return result;
}
function assertRuleArray(value: readonly unknown[]): void {
  const prototype: unknown = Object.getPrototypeOf(value);
  if (!Array.isArray(prototype)) fail();
  const constructor: unknown = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
  if (typeof constructor !== "function" ||
      Object.getOwnPropertyDescriptor(constructor, "prototype")?.value !== prototype ||
      Function.prototype.toString.call(constructor) !== Function.prototype.toString.call(Array)) fail();
  const keys = Reflect.ownKeys(value).filter(key => key !== "length");
  if (keys.length !== value.length || keys.some((key, i) => key !== String(i))) fail();
}
/** The shared JSON copier supports foreign arrays; disallow array subclasses/overridden methods here. */
function ruleJson(input: unknown): ReturnType<typeof copyRuntimeJson> {
  assertRuntimeStructure(input);
  const inspect = (value: unknown): void => {
    // JSON functions (including a then method) must not be invoked by the shared copier.
    if (["function", "symbol", "bigint", "undefined"].includes(typeof value)) fail();
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) assertRuleArray(value);
    for (const [key, property] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (Array.isArray(value) && key === "length") continue;
      inspect(property.value);
    }
  };
  inspect(input);
  return copyRuntimeJson(input, maxBytes);
}
function visitTree(node: RuleCondition, visit: (node: RuleCondition) => void): void {
  visit(node);
  if (node.kind === "all" || node.kind === "any") node.conditions.forEach(child => visitTree(child, visit));
  else if (node.kind === "not") visitTree(node.condition, visit);
}
function parseTree(input: unknown): RuleCondition {
  let raw = input;
  if (typeof raw === "string") {
    if (new TextEncoder().encode(raw).byteLength > maxBytes) fail("LIMIT_EXCEEDED");
    try { raw = JSON.parse(raw); }
    catch (cause) { throw new VbdError("INVALID_ARGUMENT", { operation: "rules.parse", cause }); }
  }
  // Shared copier preflights every descriptor, cycle, prototype and JSON structural bound.
  const node = parseInput(nodeSchema, ruleJson(raw), "rules.parse");
  let count = 0;
  const freeze = (current: RuleCondition, depth: number): void => {
    if (++count > maxNodes || depth > maxDepth) fail("LIMIT_EXCEEDED");
    if (current.kind === "all" || current.kind === "any") {
      current.conditions.forEach(child => freeze(child, depth + 1));
      Object.freeze(current.conditions);
    } else if (current.kind === "not") freeze(current.condition, depth + 1);
    else if (current.kind === "selection" && current.tables) Object.freeze(current.tables);
    Object.freeze(current);
  };
  freeze(node, 0);
  return node;
}
function all(conditions: readonly RuleCondition[]): RuleAll {
  const result = parseTree({ kind: "all", conditions });
  if (result.kind !== "all") return fail();
  return result;
}
function any(conditions: readonly RuleCondition[]): RuleAny {
  const result = parseTree({ kind: "any", conditions });
  if (result.kind !== "any") return fail();
  return result;
}
function not(condition: RuleCondition): RuleNot {
  const result = parseTree({ kind: "not", condition });
  if (result.kind !== "not") return fail();
  return result;
}
function assessment(state: RuleState, reason: RuleReason, children: readonly RuleAssessment[] = []): RuleAssessment {
  return Object.freeze({ state, reason, basis: "ux-only", children: Object.freeze([...children]) });
}
function compare(actual: RuleScalar, condition: RuleComparison): RuleAssessment {
  let matched: boolean;
  switch (condition.op) {
    case "eq": matched = actual === condition.value; break;
    case "ne": matched = actual !== condition.value; break;
    default:
      // Null, false, and numeric-looking strings are never coerced into numbers.
      if (typeof actual !== "number") return assessment("notMatched", "comparison-type-mismatch");
      switch (condition.op) {
        case "lt": matched = actual < condition.value; break;
        case "lte": matched = actual <= condition.value; break;
        case "gt": matched = actual > condition.value; break;
        case "gte": matched = actual >= condition.value; break;
      }
  }
  return assessment(matched ? "matched" : "notMatched",
    matched ? "comparison-satisfied" : "comparison-not-satisfied");
}

let active = false;
function evaluate(input: RuleCondition | string, settings: RuleEvaluationOptions): RuleAssessment {
  if (active) fail("EVENT_REENTRY");
  active = true;
  try {
    // Parse the entire tree/options/prepared input before any condition observation or guard.
    const tree = parseTree(input);
    const raw = dataRecord(settings, ["context", "scope", "scopeContext", "allowedFields", "allowedPrepared", "prepared"]);
    raw.scope = ruleJson(raw.scope);
    raw.allowedFields = ruleJson(raw.allowedFields);
    // Policies may contain functions, but no getters, sparse arrays or extra array properties.
    const policies = raw.allowedPrepared;
    if (!Array.isArray(policies)) fail();
    if (policies.length > 100) fail("LIMIT_EXCEEDED");
    assertRuleArray(policies);
    const policyDescriptors = Object.getOwnPropertyDescriptors(policies);
    raw.allowedPrepared = Array.from({ length: policies.length }, (_, i) => {
      const property = policyDescriptors[String(i)];
      if (!property || !("value" in property) || !property.enumerable) return fail();
      return dataRecord(property.value, ["key", "validate"]);
    });
    if (raw.prepared !== undefined) raw.prepared = ruleJson(raw.prepared);
    const options = parseInput(optionsSchema, raw, "rules.options");
    // Native identity helper rejects forged contexts without reading their SDK-like properties.
    const selection = Context.getSelection(options.context);
    const allowedFields = new Set(options.allowedFields);
    const allowedPrepared = new Map(options.allowedPrepared.map(policy => [policy.key, policy]));
    visitTree(tree, node => {
      if (node.kind === "field" && !allowedFields.has(node.field)) fail();
      if (node.kind === "prepared" && !allowedPrepared.has(node.key)) fail();
    });
    const values = options.prepared?.values ?? {};
    if (Object.keys(values).length > 100) fail("LIMIT_EXCEEDED");
    if (Object.keys(values).some(key => !allowedPrepared.has(key))) fail();

    const snapshot = runtimeSnapshot(options.scopeContext);
    // Reuse shared normalization/online checks, not another identity or scope implementation.
    const normalize = (scope: unknown) => readScope({
      getScope: () => scope as ReadScope,
      retrieveMultipleRecords: snapshot.context.retrieveMultipleRecords
    });
    if (scopeKey(normalize(options.scope)) !== snapshot.scope) fail("CONFIG_EXPIRED");
    if (options.prepared && scopeKey(normalize(options.prepared.scope)) !== snapshot.scope) fail("CONFIG_EXPIRED");
    const check = () => snapshot.check();
    const observe = <T>(read: () => T): T => {
      check();
      try { return read(); }
      finally { check(); }
    };
    // Validate all supplied ready facts, including unused/short-circuited ones. Scalars are copied.
    for (const [key, fact] of Object.entries(values)) {
      const validate = allowedPrepared.get(key)?.validate;
      if (fact.state === "ready" && validate) observe(() => runtimePredicate(validate, fact.value));
    }
    check();
    const fields = new Map<string, RuleScalar | RuleAssessment>();
    let record: ReturnType<typeof Context.getRecord> | undefined;
    const fieldValue = (name: string): RuleScalar | RuleAssessment => {
      if (fields.has(name)) return fields.get(name)!;
      let value: RuleScalar | RuleAssessment;
      if (options.context.surface === "gridCommand") {
        value = assessment("unknown", "field-surface-unavailable");
      } else {
        const attribute = observe(() => call(formOf(options.context), "getAttribute", name));
        if (attribute === null) value = assessment("unknown", "field-not-loaded");
        else {
          const type = observe(() => resultOf(z.enum([
            "boolean", "datetime", "decimal", "double", "file", "image", "integer", "lookup",
            "memo", "money", "multiselectoptionset", "optionset", "string"
          ]), call(attribute, "getAttributeType")));
          let schema: z.ZodType<RuleScalar>;
          switch (type) {
            case "boolean": schema = z.boolean().nullable(); break;
            case "integer": case "optionset": schema = z.number().int().finite().nullable(); break;
            case "decimal": case "double": case "money": schema = z.number().finite().nullable(); break;
            case "memo": case "string": schema = z.string().max(32_768).nullable(); break;
            default: throw new VbdError("FIELD_TYPE_MISMATCH", { operation: "rules.field" });
          }
          value = observe(() => resultOf(schema, call(attribute, "getValue")));
        }
      }
      fields.set(name, value);
      return value;
    };
    const run = (node: RuleCondition): RuleAssessment => {
      check();
      switch (node.kind) {
        case "all": case "any": {
          const children: RuleAssessment[] = [];
          const isAll = node.kind === "all";
          for (const child of node.conditions) {
            const result = run(child);
            children.push(result);
            if (result.state === (isAll ? "notMatched" : "matched")) {
              return assessment(result.state, isAll ? "all-not-matched" : "any-satisfied", children);
            }
          }
          if (children.some(child => child.state === "unknown")) {
            return assessment("unknown", isAll ? "all-unknown" : "any-unknown", children);
          }
          return assessment(isAll ? "matched" : "notMatched", isAll ? "all-satisfied" : "any-not-matched", children);
        }
        case "not": {
          const child = run(node.condition);
          return child.state === "unknown" ? assessment("unknown", "negated-unknown", [child])
            : child.state === "matched" ? assessment("notMatched", "negated-match", [child])
              : assessment("matched", "negated-no-match", [child]);
        }
        case "record": {
          record ??= observe(() => Context.getRecord(options.context));
          if (record.state === "none") return assessment("unknown", "record-unavailable");
          const matched = record.state === node.state;
          return assessment(matched ? "matched" : "notMatched",
            matched ? "record-state-satisfied" : "record-state-not-satisfied");
        }
        case "selection": {
          if (options.context.surface !== "gridCommand") return assessment("unknown", "selection-surface-unavailable");
          const matched = selection.length >= node.min && selection.length <= node.max &&
            (!node.tables || selection.every(ref => node.tables!.includes(ref.entityType)));
          return assessment(matched ? "matched" : "notMatched", matched ? "selection-satisfied" : "selection-not-satisfied");
        }
        case "capability": {
          const available = node.name === "form" ? options.context.form !== undefined : options.context.grid !== undefined;
          if (available) observe(() => Context.requireCapability(options.context, node.name));
          return assessment(available ? "matched" : "notMatched", available ? "capability-available" : "capability-unavailable");
        }
        case "field": {
          const value = fieldValue(node.field);
          return typeof value === "object" && value !== null ? value : compare(value, node);
        }
        case "prepared": {
          const fact = values[node.key];
          if (!fact) return assessment("unknown", "prepared-missing");
          if (fact.state === "notReady") return assessment("unknown", "prepared-not-ready");
          return compare(fact.value, node);
        }
      }
    };
    const result = run(tree);
    check();
    return result;
  } finally {
    active = false;
  }
}

export const Rules = Object.freeze({ evaluate, all, any, not });
