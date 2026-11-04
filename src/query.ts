import { z } from "zod";
import { XMLBuilder, XMLParser, XMLValidator } from "fast-xml-parser";
import { checkedXml } from "./xml.js";
import { parseInput } from "./validation.js";
import {
  fail, nameSchema, odataColumnsSchema, odataReadPropertySchema, ownKeys, pageSizeSchema, plain, ReadSession, rows, session, table
} from "./data-core.js";
import type { ClientOptions } from "./data-core.js";
import { buildFilter } from "./query-filter.js";
export type { FilterNode, FilterOperator, FilterPolicy, ScalarType } from "./query-filter.js";

export interface ODataOptions {
  /** Explicit entity-set metadata, not a pluralized logical name. */
  entitySet: string;
  select: string[];
  pageSize: number;
  /** Explicit advanced expression; values should normally come from buildFilter. */
  filter?: string;
  orderBy?: { column: string; direction: "asc" | "desc" }[];
  expand?: { navigationProperty: string; select: string[]; top: number }[];
  top?: number;
}
export interface FetchXmlOptions { xml: string; pageSize: number }
export type QuerySpecification =
  | { kind: "odata"; table: string; options: ODataOptions }
  | { kind: "fetchxml"; table: string; options: FetchXmlOptions }
  | { kind: "continuation"; continuation: Continuation };
/** Opaque in-memory capability; not serializable and cannot be forged across scopes. */
export interface Continuation { readonly kind: "odata" | "fetchxml" }
export interface Page {
  records: Record<string, unknown>[];
  complete: boolean;
  continuation?: Continuation;
}
export type StopReason = "complete" | "maxPages" | "maxRecords" | "cancelled";
export interface IteratedPage extends Page { stopReason?: StopReason }
export interface PagingLimits {
  maxPages: number;
  maxRecords: number;
  signal?: AbortSignal;
}
export interface AllResult extends Page { reason: StopReason; pages: number }

const odataSchema = z.object({
  entitySet: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,127}$/),
  select: odataColumnsSchema,
  pageSize: pageSizeSchema,
  filter: z.string().min(1).max(65_536).refine((value) => value.trim() === value).optional(),
  orderBy: z.array(z.object({
    column: odataReadPropertySchema.transform((name) => name.toLowerCase()), direction: z.enum(["asc", "desc"])
  }).strict()).min(1).max(100).optional(),
  expand: z.array(z.object({
    navigationProperty: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,127}$/),
    select: odataColumnsSchema, top: z.number().int().min(1).max(100)
  }).strict()).min(1).max(10).optional(),
  top: pageSizeSchema.optional()
}).strict().refine((value) => value.top === undefined || value.top <= value.pageSize);
const xmlOptions = { ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false,
  parseAttributeValue: false, trimValues: false, processEntities: true } as const;
const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: "@_", processEntities: true });

interface Cursor {
  kind: "odata" | "fetchxml";
  table: string;
  size: number;
  scope: string;
  query: string;
  baseQuery?: string;
  entitySet?: string;
  responseMaximum?: number;
  fetchRoot?: Record<string, unknown>;
  page?: number;
  fingerprints: ReadonlySet<string>;
  buffered?: Record<string, unknown>[];
  afterBuffer?: Continuation;
}
const cursors = new WeakMap<Continuation, Cursor>();
function token(cursor: Cursor): Continuation {
  const result = Object.freeze({ kind: cursor.kind });
  cursors.set(result, cursor);
  return result;
}
function continuationCursor(input: Continuation, bound: ReadSession): Cursor {
  const cursor = plain(input) ? cursors.get(input) : undefined;
  if (!cursor) { return fail(); }
  if (cursor.scope !== bound.key) { return fail("CONFIG_EXPIRED"); }
  return cursor;
}
function odataQuery(options: z.output<typeof odataSchema>): string {
  const parts: [string, string][] = [["$select", options.select.join(",")]];
  if (options.filter !== undefined) { parts.push(["$filter", options.filter]); }
  if (options.orderBy) {
    parts.push(["$orderby", options.orderBy.map((item) => `${item.column} ${item.direction}`).join(",")]);
  }
  if (options.expand) {
    parts.push(["$expand", options.expand.map((item) =>
      `${item.navigationProperty}($select=${item.select.join(",")};$top=${item.top})`).join(",")]);
  }
  if (options.top !== undefined) { parts.push(["$top", String(options.top)]); }
  const query = `?${parts.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&")}`;
  if (query.length > 262_144) { return fail("LIMIT_EXCEEDED"); }
  return query;
}

/** Supported FetchXML subset: selected root attributes, order, and scalar filters; no joins/aggregates. */
function validateFetch(root: Record<string, unknown>, logicalName: string): void {
  ownKeys(root, ["entity", "@_version", "@_mapping", "@_distinct", "@_no-lock"]);
  if (root["@_version"] !== undefined && root["@_version"] !== "1.0" ||
      root["@_mapping"] !== undefined && root["@_mapping"] !== "logical" ||
      ["@_distinct", "@_no-lock"].some((key) =>
        root[key] !== undefined && root[key] !== "true" && root[key] !== "false")) { fail(); }
  if (!plain(root.entity) || root.entity["@_name"] !== logicalName) { fail(); }
  const entity = root.entity;
  ownKeys(entity, ["@_name", "attribute", "order", "filter"]);
  const array = (value: unknown): unknown[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
  const attributes = array(entity.attribute);
  if (attributes.length < 1 || attributes.length > 100) { fail(); }
  for (const attribute of attributes) {
    if (!plain(attribute)) { fail(); }
    ownKeys(attribute, ["@_name"]);
    parseInput(nameSchema, attribute["@_name"], "query.fetchxml");
  }
  const orders = array(entity.order);
  if (orders.length < 1 || orders.length > 100) { fail(); }
  for (const order of orders) {
    if (!plain(order)) { fail(); }
    ownKeys(order, ["@_attribute", "@_descending"]);
    parseInput(nameSchema, order["@_attribute"], "query.fetchxml");
    if (order["@_descending"] !== undefined && !["true", "false"].includes(String(order["@_descending"]))) {
      fail();
    }
  }
  let count = 0;
  const filter = (value: unknown, depth: number): void => {
    if (++count > 100 || depth > 8) { fail("LIMIT_EXCEEDED"); }
    if (!plain(value)) { fail(); }
    ownKeys(value, ["@_type", "condition", "filter"]);
    if (value["@_type"] !== undefined && value["@_type"] !== "and" && value["@_type"] !== "or") { fail(); }
    for (const condition of array(value.condition)) {
      if (++count > 100) { fail("LIMIT_EXCEEDED"); }
      if (!plain(condition)) { fail(); }
      ownKeys(condition, ["@_attribute", "@_operator", "@_value", "value"]);
      parseInput(nameSchema, condition["@_attribute"], "query.fetchxml");
      const operator = parseInput(z.enum(["eq", "ne", "gt", "ge", "lt", "le", "null", "not-null", "in"]),
        condition["@_operator"], "query.fetchxml");
      if (operator === "in") {
        const values = array(condition.value);
        if (values.length < 1 || values.length > 100 || condition["@_value"] !== undefined ||
            values.some((entry) => typeof entry !== "string")) { fail(); }
      } else if (operator === "null" || operator === "not-null") {
        if (condition["@_value"] !== undefined || condition.value !== undefined) { fail(); }
      } else if (typeof condition["@_value"] !== "string" || condition.value !== undefined) { fail(); }
    }
    for (const nested of array(value.filter)) { filter(nested, depth + 1); }
  };
  for (const value of array(entity.filter)) { filter(value, 0); }
}
function initial(specification: QuerySpecification, bound: ReadSession): Cursor {
  if (!plain(specification)) { return fail(); }
  if (specification.kind === "continuation") {
    ownKeys(specification, ["kind", "continuation"]);
    return continuationCursor(specification.continuation, bound);
  }
  ownKeys(specification, ["kind", "table", "options"]);
  const logicalName = table(specification.table);
  if (specification.kind === "odata") {
    const options = parseInput(odataSchema, specification.options, "query.odata");
    const query = odataQuery(options);
    return {
      kind: "odata", table: logicalName, size: options.pageSize, scope: bound.key, query,
      baseQuery: query, entitySet: options.entitySet, responseMaximum: options.top ?? options.pageSize,
      fingerprints: new Set()
    };
  }
  if (specification.kind !== "fetchxml") { return fail(); }
  const options = parseInput(z.object({ xml: z.string(), pageSize: pageSizeSchema }).strict(),
    specification.options, "query.fetchxml");
  const { root } = checkedXml(options.xml, "fetch");
  validateFetch(root, logicalName);
  const fetchRoot = { ...root, "@_count": String(options.pageSize), "@_page": "1" };
  const xml: unknown = builder.build({ fetch: fetchRoot });
  if (typeof xml !== "string") { return fail(); }
  checkedXml(xml, "fetch");
  return { kind: "fetchxml", table: logicalName, size: options.pageSize, scope: bound.key,
    query: `?fetchXml=${xml}`, fetchRoot, page: 1, fingerprints: new Set() };
}
function nextOData(value: unknown, cursor: Cursor, bound: ReadSession): Cursor {
  if (typeof value !== "string" || value.length < 1 || value.length > 262_144 ||
      value.includes("\\") || /%(?![0-9a-f]{2})/i.test(value) ||
      [...value].some((character) => character.charCodeAt(0) <= 32)) {
    return fail("DATA_RESPONSE_INVALID");
  }
  let url: URL;
  try { url = new URL(value); } catch { return fail("DATA_RESPONSE_INVALID"); }
  if (url.origin !== bound.scope.environmentUrl || url.username || url.password || url.hash ||
      !/^\/api\/data\/v9\.[012]\/[A-Za-z][A-Za-z0-9_]*$/.test(url.pathname) ||
      url.pathname.split("/").at(-1) !== cursor.entitySet) { return fail("DATA_RESPONSE_INVALID"); }
  const original = new URLSearchParams(cursor.baseQuery);
  const params = url.searchParams;
  const keys = [...params.keys()];
  if (keys.length !== new Set(keys).size || !params.get("$skiptoken") ||
      keys.some((key) => key !== "$skiptoken" && !original.has(key)) ||
      [...original].some(([key, item]) => params.get(key) !== item)) {
    return fail("DATA_RESPONSE_INVALID");
  }
  const fingerprint = params.get("$skiptoken");
  if (!fingerprint || cursor.fingerprints.has(fingerprint)) { return fail("DATA_RESPONSE_INVALID"); }
  return { ...cursor, query: url.search, fingerprints: new Set([...cursor.fingerprints, fingerprint]) };
}
function cookieRoot(xml: string): Record<string, unknown> {
  if (xml.length > 262_144 || new TextEncoder().encode(xml).byteLength > 262_144 ||
      /<!\s*(DOCTYPE|ENTITY)\b/i.test(xml) || XMLValidator.validate(xml) !== true) {
    return fail("DATA_RESPONSE_INVALID");
  }
  const document: unknown = new XMLParser(xmlOptions).parse(xml);
  if (!plain(document) || Object.keys(document).length !== 1 || !plain(document.cookie)) {
    return fail("DATA_RESPONSE_INVALID");
  }
  return document.cookie;
}
function nextFetch(value: unknown, cursor: Cursor): Cursor {
  if (typeof value !== "string" || !cursor.fetchRoot || !cursor.page) { return fail("DATA_RESPONSE_INVALID"); }
  const wrapper = cookieRoot(value);
  const next = cursor.page + 1;
  if (wrapper["@_pagenumber"] !== String(next) || typeof wrapper["@_pagingcookie"] !== "string" ||
      Object.keys(wrapper).some((key) => !["@_pagenumber", "@_pagingcookie", "@_istracking"].includes(key))) {
    return fail("DATA_RESPONSE_INVALID");
  }
  let inner: string;
  try { inner = decodeURIComponent(decodeURIComponent(wrapper["@_pagingcookie"])); }
  catch { return fail("DATA_RESPONSE_INVALID"); }
  const decoded = cookieRoot(inner);
  if (decoded["@_page"] !== String(cursor.page) || cursor.fingerprints.has(inner)) {
    return fail("DATA_RESPONSE_INVALID");
  }
  const root = { ...cursor.fetchRoot, "@_page": String(next), "@_paging-cookie": inner };
  const xml: unknown = builder.build({ fetch: root });
  if (typeof xml !== "string") { return fail("DATA_RESPONSE_INVALID"); }
  checkedXml(xml, "fetch");
  return { ...cursor, fetchRoot: root, page: next, query: `?fetchXml=${xml}`,
    fingerprints: new Set([...cursor.fingerprints, inner]) };
}
async function executeCursor(cursor: Cursor, bound: ReadSession): Promise<Page> {
  bound.check();
  if (cursor.scope !== bound.key) { return fail("CONFIG_EXPIRED"); }
  if (cursor.buffered) {
    return { records: cursor.buffered.map((entry) => ({ ...entry })), complete: !cursor.afterBuffer,
      ...(cursor.afterBuffer ? { continuation: cursor.afterBuffer } : {}) };
  }
  return bound.run(
    () => bound.context.retrieveMultipleRecords(cursor.table, cursor.query, cursor.size),
    (response) => {
      if (!plain(response)) { return fail("DATA_RESPONSE_INVALID"); }
      const records = rows(response.entities, cursor.responseMaximum ?? cursor.size);
      const nextLink = response.nextLink;
      const cookie = response.fetchXmlPagingCookie;
      if (nextLink !== undefined && (typeof nextLink !== "string" || !nextLink) ||
          cookie !== undefined && (typeof cookie !== "string" || !cookie)) {
        return fail("DATA_RESPONSE_INVALID");
      }
      if (cursor.kind === "odata" && cookie !== undefined ||
          cursor.kind === "fetchxml" && nextLink !== undefined) { return fail("DATA_RESPONSE_INVALID"); }
      const value = cursor.kind === "odata" ? nextLink : cookie;
      if (value === undefined) {
        // A full FetchXML page without a cookie is ambiguous (simple paging is not implemented).
        if (cursor.kind === "fetchxml" && records.length === cursor.size) {
          return fail("UNSUPPORTED_SURFACE");
        }
        return { records, complete: true };
      }
      if (records.length === 0) { return fail("DATA_RESPONSE_INVALID"); }
      const next = cursor.kind === "odata" ? nextOData(value, cursor, bound) : nextFetch(value, cursor);
      return { records, complete: false, continuation: token(next) };
    }
  );
}
async function executeSpecification(specification: QuerySpecification, bound: ReadSession): Promise<Page> {
  return executeCursor(initial(specification, bound), bound);
}
async function executeOData(logicalName: string, options: ODataOptions, client?: ClientOptions): Promise<Page> {
  return executeSpecification({ kind: "odata", table: logicalName, options }, session(client));
}
async function executeFetchXml(logicalName: string, options: FetchXmlOptions, client?: ClientOptions): Promise<Page> {
  return executeSpecification({ kind: "fetchxml", table: logicalName, options }, session(client));
}
function limits(input: PagingLimits): PagingLimits {
  if (!plain(input)) { return fail(); }
  ownKeys(input, ["maxPages", "maxRecords", "signal"]);
  const maxPages = parseInput(z.number().int().min(1).max(100), input.maxPages, "query.limits");
  const maxRecords = parseInput(z.number().int().min(1).max(100_000), input.maxRecords, "query.limits");
  if (input.signal !== undefined && (!isSignal(input.signal))) { return fail(); }
  return { maxPages, maxRecords, ...(input.signal === undefined ? {} : { signal: input.signal }) };
}
function isSignal(value: unknown): value is AbortSignal {
  // Structural check is safe in a DOM-free import/host; no global AbortSignal access.
  return typeof value === "object" && value !== null && "aborted" in value &&
    typeof value.aborted === "boolean" && "addEventListener" in value &&
    typeof value.addEventListener === "function" && "removeEventListener" in value &&
    typeof value.removeEventListener === "function";
}
async function* iteratePages(specification: QuerySpecification, settings: PagingLimits,
  client?: ClientOptions): AsyncGenerator<IteratedPage> {
  const limit = limits(settings);
  const bound = session(client);
  let cursor = initial(specification, bound);
  let count = 0;
  for (let pageNumber = 1; pageNumber <= limit.maxPages; pageNumber++) {
    bound.check();
    if (limit.signal?.aborted) {
      yield { records: [], complete: false, continuation: token(cursor), stopReason: "cancelled" };
      return;
    }
    const page = await executeCursor(cursor, bound);
    const available = limit.maxRecords - count;
    let output: Page = page;
    if (page.records.length > available) {
      output = { records: page.records.slice(0, available), complete: false, continuation: token({
        ...cursor, buffered: page.records.slice(available),
        ...(page.continuation ? { afterBuffer: page.continuation } : {})
      }) };
    }
    count += output.records.length;
    const stopReason = limit.signal?.aborted ? "cancelled" : output.complete ? "complete"
      : count >= limit.maxRecords ? "maxRecords" : pageNumber === limit.maxPages ? "maxPages" : undefined;
    yield { ...output, complete: stopReason === "cancelled" ? false : output.complete,
      ...(stopReason ? { stopReason } : {}) };
    if (stopReason) { return; }
    if (!output.continuation) { return fail("DATA_RESPONSE_INVALID"); }
    // Checks also run after the consumer resumes the generator, before another request.
    bound.check();
    cursor = continuationCursor(output.continuation, bound);
  }
}
async function retrieveAll(specification: QuerySpecification, settings: PagingLimits,
  client?: ClientOptions): Promise<AllResult> {
  const records: Record<string, unknown>[] = [];
  let pages = 0;
  for await (const page of iteratePages(specification, settings, client)) {
    if (page.records.length > 0) { pages++; }
    records.push(...page.records);
    if (page.stopReason) {
      return { records, pages, complete: page.complete, reason: page.stopReason,
        ...(page.continuation ? { continuation: page.continuation } : {}) };
    }
  }
  return fail("DATA_RESPONSE_INVALID");
}
export const Query = Object.freeze({ executeOData, executeFetchXml, iteratePages, retrieveAll, buildFilter });
