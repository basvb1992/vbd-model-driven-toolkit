import { z } from "zod";
import { entityReference } from "./entity-reference.js";
import type { EntityRef } from "./entity-reference.js";
import { parseInput } from "./validation.js";
import {
  columnsSchema, etagSchema, fail, fields, odataColumnsSchema, ownKeys, plain, row, rows, session, table
} from "./data-core.js";
import type { ClientOptions, JsonFields } from "./data-core.js";
import { Query } from "./query.js";
import type { ODataOptions, Page } from "./query.js";
export type { DataContext, JsonFields, JsonValue, ClientOptions } from "./data-core.js";

export interface MutationOptions extends ClientOptions { allowedFields: string[] }
export interface UpdateOptions extends MutationOptions { etag?: string }
export interface DeleteOptions extends ClientOptions {
  policy: "confirm-delete";
  /** Deliberately confirm the exact destructive target, not a blanket default. */
  confirmation: EntityRef;
}
export interface RelatedOptions {
  /** Explicit relationship metadata; never derived from table/display/plural names. */
  navigationProperty: string;
  cardinality: "single" | "collection";
  rootColumns: string[];
  columns: string[];
  maximum: number;
}
export type RelatedResult =
  | { kind: "single"; record: Record<string, unknown> | null }
  | { kind: "collection"; records: Record<string, unknown>[]; complete: boolean;
      reason: "complete" | "limit" | "unsupportedContinuation" };
const systemFields = new Set([
  "createdon", "createdby", "createdonbehalfby", "modifiedon", "modifiedby", "modifiedonbehalfby",
  "versionnumber", "owningbusinessunit", "owninguser", "owningteam"
]);
function mutation(input: unknown, options: MutationOptions, update: boolean): JsonFields {
  if (!plain(options)) { return fail(); }
  ownKeys(options, update ? ["allowedFields", "context", "etag"] : ["allowedFields", "context"]);
  const allowed = parseInput(columnsSchema, options.allowedFields, "data.payload");
  const payload = fields(input);
  for (const [key, value] of Object.entries(payload)) {
    if (!allowed.includes(key) || systemFields.has(key) || (typeof value === "object" && value !== null)) {
      return fail(); // Deep inserts, bindings, and relationship writes are deliberately not inferred.
    }
  }
  return payload;
}
function clientOnly(options: ClientOptions): ClientOptions {
  return options.context === undefined ? {} : { context: options.context };
}
function writeRef(response: unknown, expected: { entityType: string; id?: string }): EntityRef {
  if (!plain(response)) { return fail("DATA_RESPONSE_INVALID"); }
  const ref = entityReference({ entityType: response.entityType, id: response.id });
  if (ref.entityType !== expected.entityType || (expected.id !== undefined && ref.id !== expected.id)) {
    return fail("DATA_RESPONSE_INVALID");
  }
  return ref;
}
async function retrieve(reference: EntityRef, columns: string[], client?: ClientOptions): Promise<Record<string, unknown>> {
  const ref = entityReference(reference);
  const selected = parseInput(odataColumnsSchema, columns, "data.retrieve");
  const bound = session(client);
  const method = bound.context.retrieveRecord;
  if (typeof method !== "function") { return fail("UNSUPPORTED_SURFACE"); }
  return bound.run(() => method.call(bound.context, ref.entityType, ref.id, `?$select=${selected.join(",")}`), row);
}
async function retrieveMany(logicalName: string, options: ODataOptions, client?: ClientOptions): Promise<Page> {
  return Query.executeOData(logicalName, options, client);
}
async function create(logicalName: string, input: JsonFields, options: MutationOptions): Promise<EntityRef> {
  const entityType = table(logicalName);
  const data = mutation(input, options, false);
  const bound = session(clientOnly(options));
  const method = bound.context.createRecord;
  if (typeof method !== "function") { return fail("UNSUPPORTED_SURFACE"); }
  return bound.run(() => method.call(bound.context, entityType, data),
    (response) => writeRef(response, { entityType }), true);
}
async function update(reference: EntityRef, input: JsonFields, options: UpdateOptions): Promise<EntityRef> {
  const ref = entityReference(reference);
  const data = mutation(input, options, true);
  const etag = options.etag === undefined ? undefined : parseInput(etagSchema, options.etag, "data.update");
  const bound = session(clientOnly(options));
  if (etag !== undefined) {
    const conditional = bound.context.updateRecordConditional;
    if (typeof conditional !== "function") { return fail("UNSUPPORTED_SURFACE"); }
    return bound.run(() => conditional.call(bound.context, ref, data, etag),
      (response) => writeRef(response, ref), true);
  }
  const method = bound.context.updateRecord;
  if (typeof method !== "function") { return fail("UNSUPPORTED_SURFACE"); }
  return bound.run(() => method.call(bound.context, ref.entityType, ref.id, data),
    (response) => writeRef(response, ref), true);
}
async function deleteRecord(reference: EntityRef, options: DeleteOptions): Promise<EntityRef> {
  const ref = entityReference(reference);
  if (!plain(options)) { return fail(); }
  ownKeys(options, ["policy", "confirmation", "context"]);
  if (options.policy !== "confirm-delete") { return fail(); }
  const confirmation = entityReference(options.confirmation);
  if (confirmation.entityType !== ref.entityType || confirmation.id !== ref.id) { return fail(); }
  const bound = session(clientOnly(options));
  const method = bound.context.deleteRecord;
  if (typeof method !== "function") { return fail("UNSUPPORTED_SURFACE"); }
  return bound.run(() => method.call(bound.context, ref.entityType, ref.id),
    (response) => writeRef(response, ref), true);
}
async function exists(logicalName: string,
  options: { entitySet: string; select: string[]; filter: string }, client?: ClientOptions): Promise<boolean> {
  const query = parseInput(z.object({
    entitySet: z.string(), select: odataColumnsSchema, filter: z.string().min(1).max(65_536)
  }).strict(), options, "data.exists");
  const page = await Query.executeOData(logicalName, { ...query, pageSize: 1, top: 1 }, client);
  return page.records.length !== 0;
}
async function retrieveRelated(reference: EntityRef, input: RelatedOptions, client?: ClientOptions): Promise<RelatedResult> {
  const ref = entityReference(reference);
  const options = parseInput(z.object({
    navigationProperty: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,127}$/),
    cardinality: z.enum(["single", "collection"]), rootColumns: odataColumnsSchema, columns: odataColumnsSchema,
    maximum: z.number().int().min(1).max(1000)
  }).strict(), input, "data.related");
  const bound = session(client);
  const method = bound.context.retrieveRecord;
  if (typeof method !== "function") { return fail("UNSUPPORTED_SURFACE"); }
  const navigation = options.navigationProperty;
  const query = `?$select=${options.rootColumns.join(",")}&$expand=${navigation}($select=${options.columns.join(",")}${
    options.cardinality === "collection" ? `;$top=${options.maximum + 1}` : ""})`;
  return bound.run(() => method.call(bound.context, ref.entityType, ref.id, query), (response) => {
    if (!plain(response) || !Object.hasOwn(response, navigation)) { return fail("DATA_RESPONSE_INVALID"); }
    const related = response[navigation];
    if (options.cardinality === "single") {
      if (response[`${navigation}@odata.nextLink`] !== undefined) { return fail("DATA_RESPONSE_INVALID"); }
      return { kind: "single", record: related === null ? null : row(related) };
    }
    const records = rows(related, options.maximum + 1);
    const next = response[`${navigation}@odata.nextLink`];
    if (next !== undefined && (typeof next !== "string" || !next)) { return fail("DATA_RESPONSE_INVALID"); }
    // Expanded relationship paging is not replayed through retrieveMultipleRecords with a guessed route.
    const reason = records.length > options.maximum ? "limit"
      : next !== undefined ? "unsupportedContinuation" : "complete";
    return { kind: "collection", records: records.slice(0, options.maximum),
      complete: reason === "complete", reason };
  });
}
export const Data = Object.freeze({ retrieve, retrieveMany, create, update, delete: deleteRecord, exists, retrieveRelated });
