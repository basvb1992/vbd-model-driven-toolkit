import { z } from "zod";
import { runtimePredicate } from "./configuration-values.js";
import { entityRefSchema } from "./entity-reference.js";
import type { EntityRef } from "./entity-reference.js";
import { VbdError } from "./errors.js";
import { attributeOf, controlOf } from "./forms.js";
import { call, resultOf, sdkObject } from "./sdk.js";
import type { SdkObject } from "./sdk.js";
import { logicalNameSchema, parseInput } from "./validation.js";
import { checkedXml } from "./xml.js";
import { assertXmlCharacters } from "./utils.js";

export const lookupTables = z.array(logicalNameSchema.transform(value => value.toLowerCase())).min(1).max(100)
  .refine(values => new Set(values).size === values.length);
export const lookupRefs = z.array(entityRefSchema).max(100)
  .refine(values => new Set(values.map(ref => `${ref.entityType}:${ref.id}`)).size === values.length);
export const callback = <T>() => z.custom<T>(value => typeof value === "function");
export function copyRefs(refs: readonly EntityRef[]): EntityRef[] { return refs.map(ref => ({ ...ref })); }
export function lookupError(code: ConstructorParameters<typeof VbdError>[0], operation: string, cause?: unknown): VbdError {
  return new VbdError(code, { operation, ...(cause === undefined ? {} : { cause }) });
}

/** Preserve both original callback failure and scope evidence if both fail. */
export function checkedFailure(check: () => void, failure?: { error: unknown }): void {
  try { check(); }
  catch (scope) {
    throw lookupError("CONFIG_EXPIRED", "lookups.scope", { scope, ...(failure ? { error: failure.error } : {}) });
  }
}
export function callbackFailure(error: unknown, operation: string): VbdError {
  if (error instanceof VbdError) return error;
  let status: unknown, code: unknown;
  try {
    const descriptor = typeof error === "object" && error !== null
      ? Object.getOwnPropertyDescriptor(error, "status") : undefined;
    status = descriptor && "value" in descriptor ? descriptor.value : undefined;
    const errorCode = typeof error === "object" && error !== null
      ? Object.getOwnPropertyDescriptor(error, "errorCode") : undefined;
    code = errorCode && "value" in errorCode ? errorCode.value : undefined;
  } catch (classification) {
    return lookupError("DATA_READ_FAILED", operation, { error, classification });
  }
  const denied = status === 401 || status === 403 || (typeof code === "number" && (code >>> 0) === 0x80040220);
  return lookupError(denied ? "ACCESS_DENIED" : "DATA_READ_FAILED", operation, error);
}
/** Reject and observe accidental async output from a synchronous evidence callback. */
export function rejectAsyncEvidence(value: unknown): void {
  if (value !== null && (typeof value === "object" || typeof value === "function") && "then" in value) {
    // This is a bridge into the existing runtime guard, not a trusted result assertion.
    // The guard rejects every non-boolean output and observes invalid thenables.
    runtimePredicate(() => value as unknown as boolean, undefined);
    throw lookupError("DATA_RESPONSE_INVALID", "lookups.evidence");
  }
}
export function nativeVoid(value: unknown): void {
  rejectAsyncEvidence(value);
  if (value !== undefined) throw lookupError("DATA_RESPONSE_INVALID", "lookups.native");
}
export function lookupTarget(form: SdkObject, name: string, table: string) {
  const control = controlOf(form, name);
  if (call(control, "getControlType") !== "lookup") throw lookupError("UNSUPPORTED_SURFACE", "lookups.control");
  const attribute = sdkObject(call(control, "getAttribute"));
  const column = resultOf(logicalNameSchema, call(attribute, "getName"));
  if (attributeOf(form, column) !== attribute || call(attribute, "getAttributeType") !== "lookup" ||
      call(attribute, "getIsPartyList") !== false || column.toLowerCase() === "ownerid") {
    throw lookupError("UNSUPPORTED_SURFACE", "lookups.control");
  }
  const tables = resultOf(lookupTables, call(control, "getEntityTypes"));
  if (!tables.includes(table)) throw lookupError("INVALID_ARGUMENT", "lookups.target");
  return { control, attribute, column };
}

// Deliberately small XML grammar; all general XML validation stays in checkedXml.
const whitespace = z.string().refine(value => value.trim() === "");
const name = logicalNameSchema;
const condition = z.union([
  z.object({
    "@_attribute": name, "@_operator": z.enum(["eq", "ne"]), "@_value": z.string().max(2048),
    "#text": whitespace.optional()
  }).strict(),
  z.object({
    "@_attribute": name, "@_operator": z.enum(["null", "not-null"]), "#text": whitespace.optional()
  }).strict()
]);
function oneOrMany<S extends z.ZodType>(schema: S, maximum: number) {
  return z.union([schema, z.array(schema).min(1).max(maximum)]).transform(value => Array.isArray(value) ? value : [value]);
}
export const simpleFilterSchema = z.object({
  "@_type": z.enum(["and", "or"]), condition: oneOrMany(condition, 50), "#text": whitespace.optional()
}).strict();
export function boundedXml(xml: string, root: "filter" | "fetch") {
  // No declarations, PI, comments or CDATA in this subset, even though general XML permits them.
  if (typeof xml !== "string" || /<\?|<!/.test(xml)) throw lookupError("INVALID_ARGUMENT", "lookups.xml");
  const checked = checkedXml(xml, root);
  if (/&(?!(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);)/.test(xml)) {
    throw lookupError("INVALID_ARGUMENT", "lookups.xml");
  }
  for (const match of xml.matchAll(/&#(x[0-9a-fA-F]+|[0-9]+);/g)) {
    const digits = match[1] ?? "";
    const code = digits.startsWith("x") ? Number.parseInt(digits.slice(1), 16) : Number(digits);
    if (!Number.isSafeInteger(code) || code > 0x10ffff) throw lookupError("INVALID_ARGUMENT", "lookups.xml");
    assertXmlCharacters(String.fromCodePoint(code));
  }
  return checked;
}
export function dependentFilter(input: string): string {
  const parsed = boundedXml(input, "filter");
  parseInput(simpleFilterSchema, parsed.root, "lookups.filter");
  return parsed.xml;
}
export const viewFetchSchema = z.object({
  "@_version": z.literal("1.0"), "@_output-format": z.literal("xml-platform"),
  "@_mapping": z.literal("logical"), "@_distinct": z.literal("false"),
  entity: z.object({
    "@_name": name,
    attribute: oneOrMany(z.object({ "@_name": name, "#text": whitespace.optional() }).strict(), 50),
    order: oneOrMany(z.object({
      "@_attribute": name, "@_descending": z.enum(["true", "false"]), "#text": whitespace.optional()
    }).strict(), 5).optional(),
    filter: simpleFilterSchema.optional(), "#text": whitespace.optional()
  }).strict(),
  "#text": whitespace.optional()
}).strict();
const positive = (maximum: number) => z.string().regex(/^[1-9][0-9]*$/)
  .refine(value => Number.isSafeInteger(Number(value)) && Number(value) <= maximum);
export const viewLayoutSchema = z.object({
  grid: z.object({
    "@_name": z.literal("resultset"), "@_object": positive(2_147_483_647),
    "@_jump": name, "@_select": z.literal("1"), "@_icon": z.literal("1"), "@_preview": z.literal("1"),
    row: z.object({
      "@_name": z.literal("result"), "@_id": name,
      cell: oneOrMany(z.object({
        "@_name": name, "@_width": positive(1000), "#text": whitespace.optional()
      }).strict(), 20),
      "#text": whitespace.optional()
    }).strict(),
    "#text": whitespace.optional()
  }).strict()
}).strict();
