import { z } from "zod";
import { VbdError } from "./errors.js";
import type { ErrorCode } from "./errors.js";
import type { EntityRef } from "./entity-reference.js";
import { readScope, resolveReadContext, scopeKey } from "./platform.js";
import type { ReadContext } from "./platform.js";
import { isRecord, logicalNameSchema, parseInput } from "./validation.js";

/** Optional capabilities are checked before dispatch. Conditional writes must be atomic. */
export interface DataContext extends ReadContext {
  retrieveRecord?(table: string, id: string, options: string): Promise<unknown>;
  createRecord?(table: string, data: JsonFields): Promise<unknown>;
  updateRecord?(table: string, id: string, data: JsonFields): Promise<unknown>;
  deleteRecord?(table: string, id: string): Promise<unknown>;
  /** Must use an atomic If-Match-equivalent, return {entityType,id}, and reject conflicts with status:412. */
  updateRecordConditional?(ref: EntityRef, data: JsonFields, etag: string): Promise<unknown>;
  execute?(request: OperationRequest): Promise<unknown>;
}
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonFields = { [key: string]: JsonValue };
export interface OperationMetadata {
  boundParameter: string | null;
  operationType: 0 | 1;
  operationName: string;
  parameterTypes: Record<string, { typeName: string; structuralProperty: number }>;
}
export interface OperationRequest {
  [key: string]: unknown;
  getMetadata(): OperationMetadata;
}
export interface ClientOptions { context?: DataContext }
export const nameSchema = logicalNameSchema.transform((name) => name.toLowerCase());
/** OData scalar read properties only: logical names or _<logical lookup name>_value. */
export const odataReadPropertySchema = z.union([
  logicalNameSchema,
  z.string().regex(/^_[A-Za-z][A-Za-z0-9_]{0,127}_value$/i)
]);
export const odataColumnsSchema = z.array(odataReadPropertySchema.transform((name) => name.toLowerCase()))
  .min(1).max(100).refine((columns) => new Set(columns).size === columns.length);
/** Logical field names only; deliberately excludes OData lookup shadows from mutations. */
export const columnsSchema = z.array(nameSchema).min(1).max(100)
  .refine((columns) => new Set(columns).size === columns.length);
export const pageSizeSchema = z.number().int().min(1).max(5000);
export const etagSchema = z.string().regex(/^(?:W\/)?"[A-Za-z0-9._:-]{1,128}"$/);

export function fail(code: ErrorCode = "INVALID_ARGUMENT", cause?: unknown): never {
  throw new VbdError(code, { operation: "data.client", ...(cause === undefined ? {} : { cause }) });
}
const objectConstructorSource = Function.prototype.toString.call(Object);
export function plain(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || Array.isArray(value)) { return false; }
  try {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype === null) { return true; }
    if (!isRecord(prototype) || Object.getPrototypeOf(prototype) !== null) { return false; }
    // A foreign realm has its own Object.prototype/Object constructor. Verify the
    // intrinsic constructor/prototype pair instead of comparing realm identities.
    const constructor: unknown = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
    return typeof constructor === "function" &&
      Object.getOwnPropertyDescriptor(constructor, "prototype")?.value === prototype &&
      Function.prototype.toString.call(constructor) === objectConstructorSource;
  } catch {
    return false;
  }
}
export function ownKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) { fail(); }
}
export function safeKey(key: string): boolean {
  return !["__proto__", "prototype", "constructor", "getMetadata"].includes(key);
}

function rejectJsonThenable(value: unknown): void {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) { return; }
  const then: unknown = Reflect.get(value, "then");
  if (typeof then !== "function") { return; }
  // Do not await a guard's invalid async output (it may never settle). Observe both
  // rejection callbacks and native promise returns from malformed async then
  // methods. Never adopt an arbitrary then-method return (which could return
  // itself). Capture the method once so a getter is not evaluated twice.
  const ignore = () => undefined;
  void Promise.resolve().then(() => {
    const returned: unknown = Reflect.apply(then, value, [ignore, ignore]);
    try {
      // The intrinsic brand check also accepts genuine foreign-realm promises.
      Reflect.apply(Promise.prototype.then, returned, [ignore, ignore]);
    } catch { /* A then method is not required to return a native promise. */ }
  }).catch(ignore);
  fail();
}

/** Copies only finite, acyclic, plain JSON. No service entities/annotations as write payloads. */
export function jsonValue(input: unknown, payload = false): JsonValue {
  let count = 0;
  const ancestors = new Set<object>();
  const visit = (value: unknown, depth: number): JsonValue => {
    if (++count > 10_000 || depth > 8) { fail("LIMIT_EXCEEDED"); }
    rejectJsonThenable(value);
    if (value === null || typeof value === "boolean") { return value; }
    if (typeof value === "number" && Number.isFinite(value)) { return value; }
    if (typeof value === "string" && value.length <= 65_536) { return value; }
    if (!Array.isArray(value) && !plain(value)) { return fail(); }
    if (ancestors.has(value)) { fail(); }
    ancestors.add(value);
    let result: JsonValue;
    if (Array.isArray(value)) {
      if (value.length > 1000) { fail("LIMIT_EXCEEDED"); }
      if (Object.keys(value).length !== value.length) { fail(); }
      result = value.map((entry) => visit(entry, depth + 1));
    } else {
      const entries = Object.entries(value);
      if (entries.length > (payload ? 100 : 512)) { fail("LIMIT_EXCEEDED"); }
      const fields: JsonFields = {};
      for (const [key, entry] of entries) {
        if (!safeKey(key) || (payload && (!logicalNameSchema.safeParse(key).success ||
            key.startsWith("_") || key.includes("@")))) { fail(); }
        fields[key] = visit(entry, depth + 1);
      }
      result = fields;
    }
    ancestors.delete(value);
    return result;
  };
  const result = visit(input, 0);
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 262_144) {
    fail("LIMIT_EXCEEDED");
  }
  return result;
}
export function fields(input: unknown): JsonFields {
  if (!plain(input) || Object.keys(input).length === 0) { fail(); }
  const value = jsonValue(input, true);
  if (!plain(value)) { return fail(); }
  // Rebuild with the JsonValue index signature, without asserting service/caller types.
  const result: JsonFields = {};
  for (const key of Object.keys(value)) { result[key] = jsonValue(value[key], true); }
  return result;
}
export function row(input: unknown): Record<string, unknown> {
  if (!plain(input)) { fail("DATA_RESPONSE_INVALID"); }
  try {
    const value = jsonValue(input);
    if (!plain(value)) { return fail("DATA_RESPONSE_INVALID"); }
    if (value["@odata.etag"] !== undefined && !etagSchema.safeParse(value["@odata.etag"]).success) {
      fail("DATA_RESPONSE_INVALID");
    }
    return value;
  } catch (cause) {
    return fail("DATA_RESPONSE_INVALID", cause);
  }
}
export function rows(input: unknown, maximum: number): Record<string, unknown>[] {
  if (!Array.isArray(input) || input.length > maximum) { fail("DATA_RESPONSE_INVALID"); }
  return input.map(row);
}

export function resolveClient(options: ClientOptions = {}): DataContext {
  const supplied = options?.context;
  if (!plain(options)) { fail(); }
  ownKeys(options, ["context"]);
  if (supplied !== undefined) {
    if (!isRecord(supplied) || typeof supplied.getScope !== "function" ||
        typeof supplied.retrieveMultipleRecords !== "function") { fail(); }
    return supplied;
  }
  const scopeContext = resolveReadContext();
  const xrm: unknown = Reflect.get(globalThis, "Xrm");
  if (!isRecord(xrm) || !isRecord(xrm.WebApi) || !isRecord(xrm.WebApi.online)) {
    return fail("UNSUPPORTED_SURFACE");
  }
  const online = xrm.WebApi.online;
  const invoke = (name: string, args: unknown[]): Promise<unknown> => {
    const method = online[name];
    if (typeof method !== "function") { fail("UNSUPPORTED_SURFACE"); }
    const result: unknown = Reflect.apply(method, online, args);
    return Promise.resolve(result);
  };
  return {
    getScope: () => scopeContext.getScope(),
    retrieveMultipleRecords: (table, query, size) => invoke("retrieveMultipleRecords", [table, query, size]),
    ...(typeof online.retrieveRecord === "function" ? {
      retrieveRecord: (table: string, id: string, query: string) => invoke("retrieveRecord", [table, id, query])
    } : {}),
    ...(typeof online.createRecord === "function" ? {
      createRecord: (table: string, data: JsonFields) => invoke("createRecord", [table, data])
    } : {}),
    ...(typeof online.updateRecord === "function" ? {
      updateRecord: (table: string, id: string, data: JsonFields) => invoke("updateRecord", [table, id, data])
    } : {}),
    ...(typeof online.deleteRecord === "function" ? {
      deleteRecord: (table: string, id: string) => invoke("deleteRecord", [table, id])
    } : {}),
    ...(typeof online.execute === "function" ? {
      execute: (request: OperationRequest) => invoke("execute", [request])
    } : {})
  };
}
export class ReadSession {
  readonly scope;
  readonly key: string;
  constructor(readonly context: DataContext) {
    this.scope = readScope(context);
    this.key = scopeKey(this.scope);
  }
  check(): void {
    if (scopeKey(readScope(this.context)) !== this.key) { fail("CONFIG_EXPIRED"); }
  }
  async run<T>(operation: () => Promise<unknown>, validate: (value: unknown) => T | PromiseLike<T>,
    mutation = false, action = false): Promise<Awaited<T>> {
    this.check();
    let response: unknown;
    try {
      response = await operation();
    } catch (cause) {
      try { this.check(); } catch (scopeCause) {
        return fail(mutation ? "MUTATION_OUTCOME_UNKNOWN" : "CONFIG_EXPIRED", scopeCause);
      }
      const status = isRecord(cause) ? cause.status : undefined;
      const denied = status === 401 || status === 403 || (isRecord(cause) &&
        typeof cause.errorCode === "number" && (cause.errorCode >>> 0) === 0x80040220);
      if (status === 412) { return fail("CONCURRENCY_CONFLICT", cause); }
      if (denied) { return fail("ACCESS_DENIED", cause); }
      // Transport failures have no authoritative server outcome. Never retry mutations.
      if (mutation && (typeof status !== "number" || status >= 500)) {
        return fail("MUTATION_OUTCOME_UNKNOWN", cause);
      }
      return fail(action ? "ACTION_FAILED" : mutation ? "DATA_WRITE_FAILED" : "DATA_READ_FAILED", cause);
    }
    try { this.check(); } catch (cause) {
      return fail(mutation ? "MUTATION_OUTCOME_UNKNOWN" : "CONFIG_EXPIRED", cause);
    }
    let validated: Awaited<T>;
    try { validated = await validate(response); } catch (cause) {
      try { this.check(); } catch (scopeCause) {
        return fail(mutation ? "MUTATION_OUTCOME_UNKNOWN" : "CONFIG_EXPIRED", scopeCause);
      }
      if (cause instanceof VbdError &&
          ["ACCESS_DENIED", "CONCURRENCY_CONFLICT", "ACTION_FAILED"].includes(cause.code)) { throw cause; }
      if (mutation) { return fail("MUTATION_OUTCOME_UNKNOWN", cause); }
      if (cause instanceof VbdError) { throw cause; }
      return fail("DATA_RESPONSE_INVALID", cause);
    }
    try { this.check(); } catch (cause) {
      return fail(mutation ? "MUTATION_OUTCOME_UNKNOWN" : "CONFIG_EXPIRED", cause);
    }
    return validated;
  }
}
export function session(options?: ClientOptions): ReadSession {
  return new ReadSession(resolveClient(options));
}
export function table(input: string): string {
  return parseInput(nameSchema, input, "data.table");
}
