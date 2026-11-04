import { z } from "zod";
import { Cache } from "./cache.js";
import { copyRuntimeJson } from "./configuration-values.js";
import { VbdError } from "./errors.js";
import type { ErrorCode } from "./errors.js";
import { readScope, scopeKey } from "./platform.js";
import type { ReadContext, ReadScope } from "./platform.js";
import { call, globalContext, sdkObject, sdkRoot } from "./sdk.js";
import { environmentRoot, guidSchema, isRecord } from "./validation.js";

const operation = "metadata.read";
function fail(code: ErrorCode = "DATA_RESPONSE_INVALID"): never {
  throw new VbdError(code, { operation });
}
const identifier = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,127}$/)
  .refine(value => !["constructor", "prototype", "__proto__"].includes(value));
const logical = identifier.refine(value => value === value.toLowerCase());
const language = z.number().int().min(1).max(65535);
const text = z.string().max(1024);
const attributeType = z.union([
  z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4),
  z.literal(5), z.literal(6), z.literal(7), z.literal(8), z.literal(9),
  z.literal(10), z.literal(11), z.literal(12), z.literal(13), z.literal(14),
  z.literal(15), z.literal(16), z.literal(17), z.literal(18), z.literal(19), z.literal(20)
]);
/** Supported SDK AttributeTypeCode values, not form attribute-type strings. */
export type MetadataAttributeType = z.infer<typeof attributeType>;
const tableFacts = {
  DisplayName: text, Description: text, PrimaryIdAttribute: logical,
  PrimaryNameAttribute: logical.nullable(), PrimaryImageAttribute: logical.nullable(),
  IsCustomEntity: z.boolean(), IsActivity: z.boolean(),
  IsOptimisticConcurrencyEnabled: z.boolean(), ObjectTypeCode: z.number().int().nonnegative()
};
const columnFacts = {
  DisplayName: text, DefaultFormValue: z.boolean(),
  Targets: z.array(logical).min(1).max(32),
  MaxLength: z.number().int().nonnegative().nullable(),
  MinValue: z.number().finite().nullable(), MaxValue: z.number().finite().nullable(),
  Precision: z.number().int().min(0).max(10).nullable(),
  RequiredLevel: z.enum(["None", "SystemRequired", "ApplicationRequired", "Recommended"]),
  IsValidForRead: z.boolean().nullable(), IsValidForCreate: z.boolean().nullable(),
  IsValidForUpdate: z.boolean().nullable()
};
const tableProperties = z.enum([
  "DisplayName", "Description", "PrimaryIdAttribute", "PrimaryNameAttribute",
  "PrimaryImageAttribute", "IsCustomEntity", "IsActivity",
  "IsOptimisticConcurrencyEnabled", "ObjectTypeCode"
]);
const columnProperties = z.enum([
  "DisplayName", "DefaultFormValue", "Targets", "MaxLength", "MinValue", "MaxValue",
  "Precision", "RequiredLevel", "IsValidForRead", "IsValidForCreate", "IsValidForUpdate"
]);
export type MetadataTableProperty = z.infer<typeof tableProperties>;
export type MetadataColumnProperty = z.infer<typeof columnProperties>;
const tableSchema = z.object({
  LogicalName: logical, EntitySetName: identifier, ...z.object(tableFacts).partial().shape
}).strict();
const columnSchema = z.object({
  EntityLogicalName: logical, LogicalName: logical, AttributeType: attributeType,
  ...z.object(columnFacts).partial().shape
}).strict();
export type TableMetadata = z.infer<typeof tableSchema>;
export type ColumnMetadata = z.infer<typeof columnSchema>;

const choiceKind = z.enum(["boolean", "picklist", "multiselect", "state", "status"]);
const choiceSource = z.object({
  EntityLogicalName: logical, LogicalName: logical, AttributeType: attributeType,
  kind: choiceKind,
  Options: z.array(z.object({
    Value: z.number().int().min(-2147483648).max(2147483647),
    Labels: z.array(z.object({ LanguageCode: language, Label: text }).strict()).min(1).max(16)
  }).strict()).max(256)
}).strict();
/** Adapter-normalized choice metadata; labels retain their actual LCID. */
export type MetadataChoiceSource = z.infer<typeof choiceSource>;
export interface ChoiceMetadata {
  table: string;
  column: string;
  kind: MetadataChoiceSource["kind"];
  languageId: number;
  choices: { value: number; label: string; languageId: number; isFallback: boolean }[];
}
const relationshipKind = z.enum(["oneToMany", "manyToOne", "manyToMany"]);
export type MetadataRelationshipKind = z.infer<typeof relationshipKind>;
const oneMany = {
  SchemaName: identifier, ReferencedEntity: logical, ReferencedAttribute: logical,
  ReferencingEntity: logical, ReferencingAttribute: logical,
  ReferencedEntityNavigationPropertyName: identifier,
  ReferencingEntityNavigationPropertyName: identifier
};
const relationship = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("oneToMany"), ...oneMany }).strict(),
  z.object({ kind: z.literal("manyToOne"), ...oneMany }).strict(),
  z.object({
    kind: z.literal("manyToMany"), SchemaName: identifier,
    Entity1LogicalName: logical, Entity2LogicalName: logical,
    Entity1NavigationPropertyName: identifier, Entity2NavigationPropertyName: identifier,
    IntersectEntityName: logical, Entity1IntersectAttribute: logical, Entity2IntersectAttribute: logical
  }).strict()
]);
export type MetadataRelationship = z.infer<typeof relationship>;
export interface RelationshipMetadata {
  table: string;
  kind: MetadataRelationshipKind;
  relationships: MetadataRelationship[];
}
export interface MetadataRelationshipSelection {
  kind: MetadataRelationshipKind;
  schemaName?: string;
  /** Referencing column; unavailable for many-to-many. */
  column?: string;
}
export interface MetadataRead<T> {
  scope: Readonly<ReadScope>;
  /** True only when the requested properties / entire filtered collection are established. */
  complete: boolean;
  metadata: T | null;
}
/** Current-user, current-environment, read-only adapters. No business record capability. */
export interface MetadataContext {
  getScope(): Readonly<ReadScope>;
  getTable?(table: string, properties: readonly MetadataTableProperty[]): Promise<MetadataRead<TableMetadata>>;
  getColumn?(table: string, column: string, properties: readonly MetadataColumnProperty[]): Promise<MetadataRead<ColumnMetadata>>;
  getChoices?(table: string, column: string, languageId: number, fallbackLanguageId?: number): Promise<MetadataRead<MetadataChoiceSource>>;
  getRelationships?(table: string, selection: Readonly<MetadataRelationshipSelection>): Promise<MetadataRead<MetadataRelationship[]>>;
}
export interface MetadataOptions { context?: MetadataContext }
export interface MetadataTableOptions extends MetadataOptions { properties?: readonly MetadataTableProperty[] }
export interface MetadataColumnOptions extends MetadataOptions { properties?: readonly MetadataColumnProperty[] }
export interface MetadataChoiceOptions extends MetadataOptions {
  languageId?: number;
  /** No fallback by default. An explicit alternative LCID is the only fallback. */
  fallbackLanguageId?: number;
}
export interface MetadataRelationshipOptions extends MetadataOptions, MetadataRelationshipSelection {}
export interface MetadataInvalidation extends MetadataOptions {
  table?: string;
  column?: string;
  /** Requested label language (UI language for table/column/relationships). */
  languageId?: number;
}

function parse<S extends z.ZodType>(schema: S, input: unknown, code: ErrorCode): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) fail(code);
  return parsed.data;
}
function safe(input: unknown, code: ErrorCode): unknown {
  try { return copyRuntimeJson(input, 65_536); }
  catch (cause) {
    if (cause instanceof VbdError && cause.code === "LIMIT_EXCEEDED") throw cause;
    // Do not retain raw metadata, credentials, accessor descriptors or service dumps.
    fail(code);
  }
}
const contextSchema = z.custom<MetadataContext>(value => isRecord(value) &&
  typeof value.getScope === "function" &&
  ["getTable", "getColumn", "getChoices", "getRelationships"].every(key =>
    value[key] === undefined || typeof value[key] === "function"));
const baseOptions = z.object({ context: contextSchema.optional() }).strict();
const selectionSchema = z.object({
  kind: relationshipKind, schemaName: identifier.optional(), column: logical.optional()
}).strict().refine(value => value.kind !== "manyToMany" || value.column === undefined);
const scopeSchema = z.object({
  environmentUrl: z.string(), userId: guidSchema, languageId: language, online: z.boolean()
}).strict();
function normalizedScope(input: unknown): ReadScope {
  const scope = parse(scopeSchema, safe(input, "DATA_RESPONSE_INVALID"), "DATA_RESPONSE_INVALID");
  if (!scope.online) fail("UNSUPPORTED_SURFACE");
  return { ...scope, environmentUrl: environmentRoot(scope.environmentUrl).origin };
}
function scopeOf(context: MetadataContext): ReadScope {
  try { return normalizedScope(context.getScope()); }
  catch (cause) { throw classify(cause); }
}

/** Read own data properties only: selected native SDK facts must not invoke getters. */
function field(input: unknown, key: string): unknown {
  if (!isRecord(input)) fail();
  const keys = Reflect.ownKeys(input);
  if (keys.length > 128) fail("LIMIT_EXCEEDED");
  for (const name of keys) {
    if (typeof name !== "string" || ["constructor", "prototype", "__proto__"].includes(name)) fail();
  }
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (!descriptor || !("value" in descriptor)) fail();
  return descriptor.value;
}
function projection(input: unknown, keys: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) result[key] = field(input, key);
  return result;
}
async function nativeRead(table: string, columns: string[]): Promise<unknown> {
  const utility = sdkRoot(["Utility"]);
  // Do not use sdk.callAsync: retain the denial/transport distinction at this boundary.
  const method = utility.getEntityMetadata;
  if (typeof method !== "function") fail("UNSUPPORTED_SURFACE");
  const pending: unknown = Reflect.apply(method, utility, [table, columns]);
  if (!isRecord(pending) || typeof pending.then !== "function") fail();
  return await pending;
}
const native: MetadataContext = {
  getScope: () => {
    const current = globalContext(), user = sdkObject(current.userSettings);
    return normalizedScope({
      environmentUrl: call(current, "getClientUrl"),
      userId: user.userId, languageId: user.languageId,
      online: call(current.client, "getClientState") === "Online"
    });
  },
  getTable: async (table, properties) => {
    const scope = scopeOf(native);
    const raw = await nativeRead(table, []);
    return {
      scope, complete: true,
      metadata: parse(tableSchema, safe(projection(raw,
        ["LogicalName", "EntitySetName", ...properties]), "DATA_RESPONSE_INVALID"), "DATA_RESPONSE_INVALID")
    };
  },
  getColumn: async (table, column, properties) => {
    if (properties.some(key => key !== "DisplayName" && key !== "DefaultFormValue")) {
      fail("UNSUPPORTED_SURFACE");
    }
    const scope = scopeOf(native);
    const raw = await nativeRead(table, [column]);
    if (field(raw, "LogicalName") !== table) fail();
    const collection = field(raw, "Attributes");
    const items: unknown = Array.isArray(collection) ? collection : call(collection, "get");
    if (!Array.isArray(items)) fail();
    if (items.length > 256) fail("LIMIT_EXCEEDED");
    if (items.length !== 1) fail(items.length === 0 ? "UNSUPPORTED_SURFACE" : "CONFIG_AMBIGUOUS");
    const selected = projection(items[0], ["EntityLogicalName", "LogicalName", "AttributeType", ...properties]);
    return {
      scope, complete: true,
      metadata: parse(columnSchema, safe(selected, "DATA_RESPONSE_INVALID"), "DATA_RESPONSE_INVALID")
    };
  }
};

// Shared Cache owns JSON copies, TTL, capacity, byte budgets, coalescing and generation checks.
// Bounded routing supplies collision-free, short cache keys and precise metadata invalidation.
interface Route {
  key: string; scope: string; source: MetadataContext; bridge: ReadContext;
  table: string; column?: string; languageId: number; relationships: boolean;
}
const routes = new Map<string, Route>();
const sourceIds = new WeakMap<MetadataContext, string>();
function sourceId(context: MetadataContext): string {
  let id = sourceIds.get(context);
  if (!id) { id = crypto.randomUUID(); sourceIds.set(context, id); }
  return id;
}
function bridgeFor(source: MetadataContext): ReadContext {
  return {
    getScope: () => scopeOf(source),
    retrieveMultipleRecords: () => { fail("UNSUPPORTED_SURFACE"); }
  };
}
function classify(cause: unknown): VbdError {
  if (cause instanceof VbdError) {
    if (cause.code === "SDK_OPERATION_FAILED" && cause.cause !== undefined) return classify(cause.cause);
    return new VbdError(cause.code, { operation });
  }
  // Error classification reads data descriptors only; errors never retain raw service responses.
  const data = (key: string): unknown => {
    if (!isRecord(cause)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(cause, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  };
  const status = data("status"), errorCode = data("errorCode");
  const denied = status === 401 || status === 403 ||
    (typeof errorCode === "number" && (errorCode >>> 0) === 0x80040220);
  return new VbdError(denied ? "ACCESS_DENIED" : status === 404 ? "RESOURCE_NOT_FOUND" : "DATA_READ_FAILED",
    { operation });
}
async function cached<T>(
  context: MetadataContext, table: string, column: string | undefined, lang: number | undefined,
  name: "getTable" | "getColumn" | "getChoices" | "getRelationships", args: unknown[],
  validate: (input: unknown) => T, expectedScope?: string
): Promise<T> {
  const bridge = bridgeFor(context), scope = readScope(bridge), scopeIdentity = scopeKey(scope);
  if (expectedScope !== undefined && expectedScope !== scopeIdentity) fail("CONFIG_EXPIRED");
  const languageId = lang ?? scope.languageId;
  const identity = JSON.stringify([sourceId(context), scopeIdentity, name, table, column, languageId, args]);
  let route = routes.get(identity);
  if (!route) {
    route = {
      key: `m${crypto.randomUUID()}`, scope: scopeIdentity, source: context, bridge,
      table, ...(column === undefined ? {} : { column }), languageId, relationships: name === "getRelationships"
    };
    routes.set(identity, route);
    if (routes.size > 128) {
      const oldest = routes.keys().next().value;
      if (oldest !== undefined) routes.delete(oldest);
    }
  }
  const current = route;
  const check = () => {
    const observed = scopeKey(readScope(bridge));
    if (observed !== scopeIdentity || routes.get(identity) !== current) fail("CONFIG_EXPIRED");
  };
  try {
    return await Cache.getOrLoad({ namespace: "vbdMetadata", key: current.key }, {
      context: bridge, approved: true, purpose: "metadata", revision: "metadata-v1",
      ttlMs: 60_000, maxBytes: 65_536,
      load: async () => {
        check();
        const method = context[name];
        if (typeof method !== "function") fail("UNSUPPORTED_SURFACE");
        let raw: unknown;
        const dispatch = parse(z.array(z.unknown()), safe(args, "INVALID_ARGUMENT"), "INVALID_ARGUMENT");
        try { raw = await Reflect.apply(method, context, dispatch); }
        catch (cause) { check(); throw classify(cause); }
        check();
        const envelope = parse(z.object({
          scope: scopeSchema, complete: z.boolean(), metadata: z.unknown()
        }).strict(), safe(raw, "DATA_RESPONSE_INVALID"), "DATA_RESPONSE_INVALID");
        if (scopeKey(normalizedScope(envelope.scope)) !== scopeIdentity) fail("CONFIG_EXPIRED");
        if (!envelope.complete) fail("UNSUPPORTED_SURFACE");
        if (envelope.metadata === null) fail("RESOURCE_NOT_FOUND");
        const value = validate(envelope.metadata);
        check();
        return value;
      },
      validate: (value: unknown): value is T => {
        check();
        // Only this module's normalized, safe JSON is stored. No caller-supplied predicates.
        safe(value, "DATA_RESPONSE_INVALID");
        check();
        return true;
      }
    });
  } catch (cause) {
    // Failed routes may be reused, but the shared cache never retains failed results.
    throw classify(cause);
  } finally { check(); }
}
function settings<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  // Context methods are deliberately capabilities, not JSON. Inspect their descriptors separately.
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) fail("INVALID_ARGUMENT");
  const clean: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || ["constructor", "prototype", "__proto__"].includes(key)) fail("INVALID_ARGUMENT");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) fail("INVALID_ARGUMENT");
    if (key === "context") {
      const context: unknown = descriptor.value;
      if (!isRecord(context)) fail("INVALID_ARGUMENT");
      for (const name of ["getScope", "getTable", "getColumn", "getChoices", "getRelationships"]) {
        let owner: object | null = context;
        let depth = 0;
        while (owner !== null && owner !== Object.prototype) {
          if (++depth > 4) fail("INVALID_ARGUMENT");
          const property = Object.getOwnPropertyDescriptor(owner, name);
          if (property) {
            if (!("value" in property)) fail("INVALID_ARGUMENT");
            break;
          }
          owner = Object.getPrototypeOf(owner) as object | null;
        }
      }
      clean[key] = context;
    } else clean[key] = safe(descriptor.value, "INVALID_ARGUMENT");
  }
  return parse(schema, clean, "INVALID_ARGUMENT");
}
function tableName(value: string): string { return parse(logical, value, "INVALID_ARGUMENT"); }
function unique(values: readonly unknown[], code: ErrorCode = "DATA_RESPONSE_INVALID"): void {
  if (new Set(values).size !== values.length) fail(code);
}
function requested(value: object, properties: readonly string[]): void {
  for (const key of properties) {
    if (!Object.hasOwn(value, key)) fail("UNSUPPORTED_SURFACE");
  }
}
async function getTable(tableInput: string, input: MetadataTableOptions = {}): Promise<TableMetadata> {
  const table = tableName(tableInput);
  const options = settings(baseOptions.extend({
    properties: z.array(tableProperties).max(9).default([])
  }), input);
  unique(options.properties, "INVALID_ARGUMENT");
  const properties = [...options.properties].sort();
  return cached(options.context ?? native, table, undefined, undefined, "getTable", [table, properties], raw => {
    const value = parse(tableSchema, raw, "DATA_RESPONSE_INVALID");
    if (value.LogicalName !== table) fail();
    requested(value, properties);
    return parse(tableSchema, projection(value, ["LogicalName", "EntitySetName", ...properties]), "DATA_RESPONSE_INVALID");
  });
}
function checkColumn(value: ColumnMetadata, table: string, column: string): void {
  if (value.EntityLogicalName !== table || value.LogicalName !== column) fail();
  const type = value.AttributeType;
  if (value.Targets !== undefined) {
    if (![1, 6, 9].includes(type)) fail();
    unique(value.Targets);
  }
  if (value.DefaultFormValue !== undefined && type !== 0) fail();
  if (value.MaxLength !== undefined && type !== 7 && type !== 14) fail();
  if ((value.MinValue !== undefined || value.MaxValue !== undefined) && ![2, 3, 5, 8, 18].includes(type)) fail();
  if (value.Precision !== undefined && ![2, 3, 8].includes(type)) fail();
  if (typeof value.MinValue === "number" && typeof value.MaxValue === "number" &&
      value.MinValue > value.MaxValue) fail();
}
async function getColumn(
  tableInput: string, columnInput: string, input: MetadataColumnOptions = {}
): Promise<ColumnMetadata> {
  const table = tableName(tableInput), column = tableName(columnInput);
  const options = settings(baseOptions.extend({
    properties: z.array(columnProperties).max(11).default([])
  }), input);
  unique(options.properties, "INVALID_ARGUMENT");
  const properties = [...options.properties].sort();
  return cached(options.context ?? native, table, column, undefined, "getColumn", [table, column, properties], raw => {
    const value = parse(columnSchema, raw, "DATA_RESPONSE_INVALID");
    checkColumn(value, table, column);
    requested(value, properties);
    return parse(columnSchema, projection(value,
      ["EntityLogicalName", "LogicalName", "AttributeType", ...properties]), "DATA_RESPONSE_INVALID");
  });
}
async function getChoices(
  tableInput: string, columnInput: string, input: MetadataChoiceOptions = {}
): Promise<ChoiceMetadata> {
  const table = tableName(tableInput), column = tableName(columnInput);
  const options = settings(baseOptions.extend({
    languageId: language.optional(), fallbackLanguageId: language.optional()
  }), input);
  const context = options.context ?? native;
  const initialScope = options.languageId === undefined ? scopeOf(context) : undefined;
  const lang = options.languageId ?? initialScope?.languageId;
  if (lang === undefined) fail("INVALID_ARGUMENT");
  if (lang === options.fallbackLanguageId) fail("INVALID_ARGUMENT");
  return cached(context, table, column, lang, "getChoices",
    [table, column, lang, ...(options.fallbackLanguageId === undefined ? [] : [options.fallbackLanguageId])], raw => {
      const source = parse(choiceSource, raw, "DATA_RESPONSE_INVALID");
      const codes = { boolean: 0, picklist: 11, multiselect: 17, state: 12, status: 13 } as const;
      if (source.EntityLogicalName !== table || source.LogicalName !== column ||
          source.AttributeType !== codes[source.kind]) fail();
      unique(source.Options.map(item => item.Value));
      if (source.kind === "boolean" &&
          (source.Options.length !== 2 || !source.Options.some(item => item.Value === 0) ||
            !source.Options.some(item => item.Value === 1))) fail();
      const choices = source.Options.map(item => {
        unique(item.Labels.map(label => label.LanguageCode));
        const selected = item.Labels.find(label => label.LanguageCode === lang) ??
          item.Labels.find(label => label.LanguageCode === options.fallbackLanguageId);
        if (!selected) fail("UNSUPPORTED_SURFACE");
        return {
          value: item.Value, label: selected.Label, languageId: selected.LanguageCode,
          isFallback: selected.LanguageCode !== lang
        };
      });
      return { table, column, kind: source.kind, languageId: lang, choices };
    }, initialScope === undefined ? undefined : scopeKey(initialScope));
}
async function getRelationships(
  tableInput: string, input: MetadataRelationshipOptions
): Promise<RelationshipMetadata> {
  const table = tableName(tableInput);
  const options = settings(baseOptions.extend(selectionSchema.shape).refine(value =>
    value.kind !== "manyToMany" || value.column === undefined), input);
  const selection = parse(selectionSchema, {
    kind: options.kind,
    ...(options.schemaName === undefined ? {} : { schemaName: options.schemaName }),
    ...(options.column === undefined ? {} : { column: options.column })
  }, "INVALID_ARGUMENT");
  return cached(options.context ?? native, table, undefined, undefined, "getRelationships", [table, selection], raw => {
    const values = parse(z.array(relationship).max(128), raw, "DATA_RESPONSE_INVALID");
    unique(values.map(item => item.SchemaName));
    for (const item of values) {
      if (item.kind !== selection.kind ||
          (selection.schemaName !== undefined && item.SchemaName !== selection.schemaName)) fail();
      if (item.kind === "manyToMany") {
        if (item.Entity1LogicalName !== table && item.Entity2LogicalName !== table) fail();
        if (item.Entity1NavigationPropertyName === item.Entity2NavigationPropertyName ||
            item.Entity1IntersectAttribute === item.Entity2IntersectAttribute) fail();
      } else {
        if ((item.kind === "oneToMany" ? item.ReferencedEntity : item.ReferencingEntity) !== table ||
            (selection.column !== undefined && item.ReferencingAttribute !== selection.column)) fail();
        if (item.ReferencedEntity === item.ReferencingEntity &&
            item.ReferencedEntityNavigationPropertyName === item.ReferencingEntityNavigationPropertyName) fail();
      }
    }
    // Two identities claiming the same table-side navigation are not an unambiguous catalog.
    unique(values.flatMap(item => {
      if (item.kind === "manyToMany") {
        return [
          ...(item.Entity1LogicalName === table ? [item.Entity1NavigationPropertyName] : []),
          ...(item.Entity2LogicalName === table ? [item.Entity2NavigationPropertyName] : [])
        ];
      }
      return [item.kind === "oneToMany" ?
        item.ReferencedEntityNavigationPropertyName : item.ReferencingEntityNavigationPropertyName];
    }));
    if (selection.schemaName !== undefined && values.length === 0) fail("RESOURCE_NOT_FOUND");
    return { table, kind: selection.kind, relationships: values };
  });
}
function invalidate(input: MetadataInvalidation = {}): number {
  const options = settings(baseOptions.extend({
    table: logical.optional(), column: logical.optional(), languageId: language.optional()
  }).refine(value => value.column === undefined || value.table !== undefined), input);
  const context = options.context ?? native, bridge = bridgeFor(context);
  const scope = scopeKey(readScope(bridge));
  let count = 0;
  for (const [identity, route] of routes) {
    if (route.source !== context || route.scope !== scope ||
        (options.table !== undefined && route.table !== options.table) ||
        (options.languageId !== undefined && route.languageId !== options.languageId) ||
        (options.column !== undefined && route.column !== options.column && !route.relationships)) continue;
    routes.delete(identity);
    count += Cache.invalidate({ namespace: "vbdMetadata", key: route.key }, { context: bridge });
  }
  if (scopeKey(readScope(bridge)) !== scope) fail("CONFIG_EXPIRED");
  return count;
}

/** Exactly the five R2 metadata catalog operations. Parent-owned index/browser wiring is separate. */
export const Metadata = Object.freeze({ getTable, getColumn, getChoices, getRelationships, invalidate });
