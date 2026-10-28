import { z } from "zod";
import { VbdError } from "./errors.js";
import { contextSchema, readRows, readScope, resolveReadContext, scopeKey } from "./platform.js";
import type { ReadContext } from "./platform.js";
import { guidSchema, logicalNameSchema, parseInput } from "./validation.js";

const defaultTtl = 60_000;
const maximumTtl = 300_000;
const maximumValueLength = 1_048_576;
const maximumCacheLength = 2_097_152;
const commonOptions = z.object({
  context: contextSchema.optional(),
  cacheTtlMs: z.number().int().min(0).max(maximumTtl).default(defaultTtl)
}).strict();
const textOptions = commonOptions.extend({
  trim: z.boolean().default(false),
  allowEmpty: z.boolean().default(false)
});
const numberOptions = commonOptions.extend({
  min: z.number().finite().optional(),
  max: z.number().finite().optional()
});
const predicateSchema = z.custom<(value: unknown) => boolean>((value) => typeof value === "function");
const jsonOptions = commonOptions.extend({ validate: predicateSchema });
const getOptions = z.discriminatedUnion("type", [
  textOptions.extend({ type: z.literal("text") }),
  numberOptions.extend({ type: z.literal("number") }),
  commonOptions.extend({ type: z.literal("boolean") }),
  jsonOptions.extend({ type: z.literal("json") })
]);
const requestSchema = z.discriminatedUnion("type", [
  textOptions.omit({ context: true, cacheTtlMs: true }).extend({ schemaName: logicalNameSchema, type: z.literal("text") }),
  numberOptions.omit({ context: true, cacheTtlMs: true }).extend({ schemaName: logicalNameSchema, type: z.literal("number") }),
  z.object({ schemaName: logicalNameSchema, type: z.literal("boolean") }).strict(),
  z.object({ schemaName: logicalNameSchema, type: z.literal("json"), validate: predicateSchema }).strict()
]);
const definitionSchema = z.object({
  environmentvariabledefinitionid: guidSchema,
  schemaname: logicalNameSchema,
  type: z.number().int()
});
const rawValueSchema = z.object({ value: z.string().max(maximumValueLength).nullable() });
const defaultValueSchema = z.object({
  type: z.number().int(),
  defaultvalue: z.string().max(maximumValueLength).nullable()
});
const types = ["text", "number", "boolean", "json", "dataSource", "secret"] as const;
export type EnvironmentType = typeof types[number];
export type ValueType = Exclude<EnvironmentType, "secret" | "dataSource">;
export type EnvironmentGetOptions = z.input<typeof getOptions>;
export type EnvironmentReadRequest = z.input<typeof requestSchema>;
export type TextReadOptions = z.input<typeof textOptions>;
export type NumberReadOptions = z.input<typeof numberOptions>;
export type CommonReadOptions = z.input<typeof commonOptions>;
export interface JsonReadOptions<T> extends CommonReadOptions {
  validate(value: unknown): value is T;
}
export interface EnvironmentDefinition {
  id: string;
  schemaName: string;
  type: EnvironmentType;
}
export interface ResolvedValue<T> {
  value: T;
  schemaName: string;
  type: ValueType;
  source: "current" | "default";
  fetchedAt: number;
  expiresAt: number;
  cached: boolean;
}
interface RawValue {
  definition: EnvironmentDefinition;
  value: string;
  source: "current" | "default";
  fetchedAt: number;
}
interface RawRead {
  raw: RawValue;
  cached: boolean;
  key: string;
  context: ReadContext;
  scope: string;
  generation: number;
}

const cache = new Map<string, RawValue>();
const inFlight = new Map<string, Promise<RawValue>>();
let cachedLength = 0;
let generation = 0;
let activeLoads = 0;

export function environmentGeneration(): number {
  return generation;
}

async function limitedLoad<T>(action: () => Promise<T>): Promise<T> {
  if (activeLoads >= 64) {
    throw new VbdError("LIMIT_EXCEEDED", { operation: "environment.read" });
  }
  activeLoads++;
  try {
    return await action();
  } finally {
    activeLoads--;
  }
}

function assertUnchanged(context: ReadContext, key: string, expectedGeneration: number): void {
  if (scopeKey(readScope(context)) !== key || generation !== expectedGeneration) {
    throw new VbdError("CONFIG_EXPIRED", { operation: "environment.read" });
  }
}

function typeFromCode(code: number): EnvironmentType {
  const type = types[code - 100000000];
  if (!type) {
    throw new VbdError("UNSUPPORTED_VARIABLE_TYPE", { operation: "environment.definition" });
  }
  return type;
}

async function loadDefinition(name: string, context: ReadContext): Promise<EnvironmentDefinition> {
  const rows = await readRows(context, "environmentvariabledefinition",
    `?$select=environmentvariabledefinitionid,schemaname,type&$filter=schemaname eq '${name}'&$top=2`);
  const first = rows[0];
  if (first === undefined) {
    throw new VbdError("CONFIG_NOT_FOUND", { operation: "environment.definition" });
  }
  const parsed = definitionSchema.safeParse(first);
  if (!parsed.success || parsed.data.schemaname.toLowerCase() !== name.toLowerCase()) {
    throw new VbdError("DATA_RESPONSE_INVALID", { operation: "environment.definition" });
  }
  return {
    id: parsed.data.environmentvariabledefinitionid,
    schemaName: parsed.data.schemaname,
    type: typeFromCode(parsed.data.type)
  };
}

async function loadRaw(name: string, context: ReadContext): Promise<RawValue> {
  const definition = await loadDefinition(name, context);
  if (definition.type === "secret" || definition.type === "dataSource") {
    throw new VbdError(definition.type === "secret" ? "SECRET_NOT_SUPPORTED" : "UNSUPPORTED_VARIABLE_TYPE", {
      operation: "environment.read"
    });
  }
  const rows = await readRows(context, "environmentvariablevalue",
    `?$select=value&$filter=_environmentvariabledefinitionid_value eq ${definition.id}&$top=2`);
  let value: string | null = null;
  let source: "current" | "default" = "current";
  if (rows[0] !== undefined) {
    const parsed = rawValueSchema.safeParse(rows[0]);
    if (!parsed.success) {
      throw new VbdError("DATA_RESPONSE_INVALID", { operation: "environment.read" });
    }
    value = parsed.data.value;
  }
  if (value === null) {
    const defaults = await readRows(context, "environmentvariabledefinition",
      `?$select=defaultvalue,type&$filter=environmentvariabledefinitionid eq ${definition.id}&$top=2`);
    const parsed = defaultValueSchema.safeParse(defaults[0]);
    if (!parsed.success) {
      throw new VbdError("DATA_RESPONSE_INVALID", { operation: "environment.read" });
    }
    if (typeFromCode(parsed.data.type) !== definition.type) {
      throw new VbdError("CONFIG_EXPIRED", { operation: "environment.read" });
    }
    value = parsed.data.defaultvalue;
    source = "default";
  }
  if (value === null) {
    throw new VbdError("CONFIG_VALUE_MISSING", { operation: "environment.read" });
  }
  return { definition, value, source, fetchedAt: Date.now() };
}

function removeCached(key: string): boolean {
  const previous = cache.get(key);
  if (!previous) {
    return false;
  }
  cachedLength -= previous.value.length;
  return cache.delete(key);
}

function remember(key: string, value: RawValue): void {
  removeCached(key);
  cache.set(key, value);
  cachedLength += value.value.length;
  while (cache.size > 128 || cachedLength > maximumCacheLength) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    removeCached(oldest);
  }
}

async function readRaw(name: string, options: z.output<typeof commonOptions>): Promise<RawRead> {
  parseInput(logicalNameSchema, name, "environment.read");
  const context = resolveReadContext(options.context);
  const scope = scopeKey(readScope(context));
  const key = `${scope}:${name.toLowerCase()}`;
  const expectedGeneration = generation;
  const previous = cache.get(key);
  if (previous) {
    const age = Date.now() - previous.fetchedAt;
    if (options.cacheTtlMs > 0 && age >= 0 && age < options.cacheTtlMs) {
      cache.delete(key);
      cache.set(key, previous);
      return {
        raw: previous, cached: true, key, context, scope, generation: expectedGeneration
      };
    }
    removeCached(key);
  }
  let pending = inFlight.get(key);
  if (!pending) {
    pending = limitedLoad(() => loadRaw(name, context)).then((value) => {
      assertUnchanged(context, scope, expectedGeneration);
      if (options.cacheTtlMs > 0) {
        remember(key, value);
      }
      return value;
    });
    inFlight.set(key, pending);
  }
  try {
    const raw = await pending;
    assertUnchanged(context, scope, expectedGeneration);
    return { raw, cached: false, key, context, scope, generation: expectedGeneration };
  } finally {
    if (inFlight.get(key) === pending) {
      inFlight.delete(key);
    }
  }
}

async function readTyped<T>(
  name: string,
  type: ValueType,
  options: z.output<typeof commonOptions>,
  convert: (value: string) => T | Promise<T>
): Promise<ResolvedValue<T>> {
  const { raw, cached, key, context, scope, generation } = await readRaw(name, options);
  try {
    if (raw.definition.type !== type) {
      throw new VbdError("CONFIG_TYPE_MISMATCH", { operation: "environment.convert" });
    }
    const value = await convert(raw.value);
    assertUnchanged(context, scope, generation);
    return {
      value,
      schemaName: raw.definition.schemaName,
      type,
      source: raw.source,
      fetchedAt: raw.fetchedAt,
      expiresAt: raw.fetchedAt + options.cacheTtlMs,
      cached
    };
  } catch (error) {
    if (cache.get(key) === raw) {
      removeCached(key);
    }
    throw error;
  }
}

function invalidValue(cause?: unknown): VbdError {
  return new VbdError("CONFIG_VALUE_INVALID", { operation: "environment.convert", cause });
}

async function getText(name: string, input: TextReadOptions = {}): Promise<ResolvedValue<string>> {
  const options = parseInput(textOptions, input, "environment.getText");
  return readTyped(name, "text", options, (raw) => {
    const value = options.trim ? raw.trim() : raw;
    if (!options.allowEmpty && value.length === 0) {
      throw invalidValue();
    }
    return value;
  });
}

async function getNumber(name: string, input: NumberReadOptions = {}): Promise<ResolvedValue<number>> {
  const options = parseInput(numberOptions, input, "environment.getNumber");
  if (options.min !== undefined && options.max !== undefined && options.min > options.max) {
    throw new VbdError("INVALID_ARGUMENT", { operation: "environment.getNumber" });
  }
  return readTyped(name, "number", options, (raw) => {
    const normalized = raw.trim();
    const value = Number(normalized);
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized) ||
        !Number.isFinite(value) || (options.min !== undefined && value < options.min) ||
        (options.max !== undefined && value > options.max)) {
      throw invalidValue();
    }
    return value;
  });
}

async function getBoolean(name: string, input: CommonReadOptions = {}): Promise<ResolvedValue<boolean>> {
  const options = parseInput(commonOptions, input, "environment.getBoolean");
  return readTyped(name, "boolean", options, (raw) => {
    switch (raw.trim().toLowerCase()) {
      case "true": case "yes": return true;
      case "false": case "no": return false;
      default: throw invalidValue();
    }
  });
}

function parseJson(raw: string): unknown {
  try {
    const value: unknown = JSON.parse(raw);
    return value;
  } catch (cause) {
    throw invalidValue(cause);
  }
}

async function getJson<T>(name: string, input: JsonReadOptions<T>): Promise<ResolvedValue<T>> {
  const options = parseInput(jsonOptions, input, "environment.getJson");
  return readTyped(name, "json", options, (raw) => parseValidatedJson(raw, input.validate));
}

function parseValidatedJson<T>(raw: string, validate: (value: unknown) => value is T): T | Promise<never>;
function parseValidatedJson(raw: string, validate: (value: unknown) => boolean): unknown | Promise<never>;
function parseValidatedJson(raw: string, validate: (value: unknown) => boolean): unknown | Promise<never> {
  const value = parseJson(raw);
  try {
    const accepted = validate(value);
    if (accepted === true) {
      return value;
    }
    // Observe invalid thenables without waiting for them or accepting async guards.
    return Promise.race([Promise.resolve(accepted), Promise.resolve()]).then(
      () => { throw invalidValue(); },
      (cause: unknown) => { throw invalidValue(cause); }
    );
  } catch (cause) {
    throw invalidValue(cause);
  }
}

async function get(name: string, input: EnvironmentGetOptions): Promise<ResolvedValue<unknown>> {
  const parsed = parseInput(getOptions, input, "environment.get");
  const { type, ...options } = parsed;
  switch (type) {
    case "text": return getText(name, options);
    case "number": return getNumber(name, options);
    case "boolean": return getBoolean(name, options);
    case "json": {
      if (!("validate" in options)) {
        throw new VbdError("INVALID_ARGUMENT", { operation: "environment.get" });
      }
      return readTyped(name, "json", parseInput(jsonOptions, options, "environment.get"),
        (raw) => parseValidatedJson(raw, options.validate));
    }
  }
}

async function getOptional(
  name: string,
  input: EnvironmentGetOptions & { absence: "definition" | "value" | "either" }
): Promise<ResolvedValue<unknown> | undefined> {
  if (input === null || typeof input !== "object") {
    throw new VbdError("INVALID_ARGUMENT", { operation: "environment.getOptional" });
  }
  const { absence, ...options } = input;
  parseInput(z.enum(["definition", "value", "either"]), absence, "environment.getOptional");
  try {
    return await get(name, options);
  } catch (error) {
    if (error instanceof VbdError &&
        ((error.code === "CONFIG_NOT_FOUND" && absence !== "value") ||
         (error.code === "CONFIG_VALUE_MISSING" && absence !== "definition"))) {
      return undefined;
    }
    throw error;
  }
}

async function getDefinition(
  name: string,
  input: { context?: ReadContext } = {}
): Promise<EnvironmentDefinition> {
  const options = parseInput(z.object({ context: contextSchema.optional() }).strict(), input, "environment.getDefinition");
  parseInput(logicalNameSchema, name, "environment.getDefinition");
  const context = resolveReadContext(options.context);
  const scope = scopeKey(readScope(context));
  const expectedGeneration = generation;
  const result = await limitedLoad(() => loadDefinition(name, context));
  assertUnchanged(context, scope, expectedGeneration);
  return result;
}

async function getMany(
  input: readonly EnvironmentReadRequest[],
  settings: CommonReadOptions & { concurrency?: number } = {}
): Promise<Record<string, ResolvedValue<unknown>>> {
  const requests = parseInput(z.array(requestSchema).min(1).max(100), input, "environment.getMany");
  const options = parseInput(commonOptions.extend({
    concurrency: z.number().int().min(1).max(8).default(4)
  }), settings, "environment.getMany");
  if (new Set(requests.map((request) => request.schemaName.toLowerCase())).size !== requests.length) {
    throw new VbdError("INVALID_ARGUMENT", { operation: "environment.getMany" });
  }
  const context = resolveReadContext(options.context);
  const batchScope = scopeKey(readScope(context));
  const batchGeneration = generation;
  const results: [string, ResolvedValue<unknown>][] = [];
  let next = 0;
  let failure: { schemaName: string; error: unknown } | undefined;
  async function worker(): Promise<void> {
    while (!failure) {
      const request = requests[next++];
      if (!request) {
        return;
      }
      const { schemaName, ...readOptions } = request;
      try {
        assertUnchanged(context, batchScope, batchGeneration);
        results.push([schemaName, await get(schemaName, {
          ...readOptions, context, cacheTtlMs: options.cacheTtlMs
        })]);
      } catch (error) {
        failure ??= { schemaName, error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency, requests.length) }, worker));
  if (failure) {
    throw new VbdError("ENVIRONMENT_BATCH_FAILED", { operation: "environment.getMany", cause: failure });
  }
  assertUnchanged(context, batchScope, batchGeneration);
  return Object.fromEntries(results);
}

async function preload(
  requests: readonly EnvironmentReadRequest[],
  options: CommonReadOptions & { concurrency?: number } = {}
): Promise<{ resolved: number }> {
  return { resolved: Object.keys(await getMany(requests, options)).length };
}

function invalidate(
  names?: string | readonly string[],
  input: { context?: ReadContext } = {}
): number {
  const options = parseInput(z.object({ context: contextSchema.optional() }).strict(), input, "environment.invalidate");
  const selection = names === undefined ? undefined : parseInput(
    z.union([logicalNameSchema, z.array(logicalNameSchema).min(1).max(100)]), names, "environment.invalidate"
  );
  const selected = selection === undefined ? undefined : new Set(
    (typeof selection === "string" ? [selection] : selection).map((name) => name.toLowerCase())
  );
  const scope = scopeKey(readScope(resolveReadContext(options.context)));
  generation++;
  let count = 0;
  for (const key of new Set([...cache.keys(), ...inFlight.keys()])) {
    const name = key.slice(scope.length + 1);
    if (key.startsWith(`${scope}:`) && (!selected || selected.has(name))) {
      count += removeCached(key) ? 1 : 0;
      inFlight.delete(key);
    }
  }
  return count;
}

export const Environment = Object.freeze({
  get, getOptional, getText, getNumber, getBoolean, getJson, getDefinition, getMany, preload, invalidate
});
