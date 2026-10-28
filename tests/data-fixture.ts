import { vi } from "vitest";
import type { DataContext, JsonFields } from "../src/data.js";
import type { OperationRequest } from "../src/data-core.js";
import type { ReadScope } from "../src/platform.js";

export const id = "11111111-1111-4111-8111-111111111111";
export const otherId = "22222222-2222-4222-8222-222222222222";
export const ref = { entityType: "account", id };
export const odata = { entitySet: "accounts", select: ["name"], pageSize: 2 };
export const fetchXml = '<fetch><entity name="account"><attribute name="name"/><order attribute="accountid"/></entity></fetch>';
export function nextLink(skiptoken = "next"): string {
  return `https://tenant.example/api/data/v9.2/accounts?$select=name&$skiptoken=${encodeURIComponent(skiptoken)}`;
}
export function fetchCookie(page = 1, last = "A&B"): string {
  const inner = `<cookie page="${page}"><accountid last="${last.replace(/&/g, "&amp;")}"/></cookie>`;
  return `<cookie pagenumber="${page + 1}" pagingcookie="${encodeURIComponent(encodeURIComponent(inner))}" istracking="False"/>`;
}
export function dataFixture() {
  const scope: ReadScope = { environmentUrl: "https://tenant.example", userId: id, languageId: 1033, online: true };
  const retrieveMultipleRecords = vi.fn<(table: string, query: string, maximum: number) => Promise<unknown>>()
    .mockResolvedValue({ entities: [] });
  const retrieveRecord = vi.fn<(table: string, id: string, query: string) => Promise<unknown>>()
    .mockResolvedValue({ name: "Synthetic", "@odata.etag": 'W/"1"' });
  const createRecord = vi.fn<(table: string, fields: JsonFields) => Promise<unknown>>().mockResolvedValue(ref);
  const updateRecord = vi.fn<(table: string, id: string, fields: JsonFields) => Promise<unknown>>().mockResolvedValue(ref);
  const deleteRecord = vi.fn<(table: string, id: string) => Promise<unknown>>().mockResolvedValue(ref);
  const execute = vi.fn<(request: OperationRequest) => Promise<unknown>>().mockResolvedValue({ ok: true, status: 204 });
  const context: DataContext = {
    getScope: () => ({ ...scope }), retrieveMultipleRecords, retrieveRecord, createRecord, updateRecord, deleteRecord, execute
  };
  return { scope, context, client: { context }, retrieveMultipleRecords, retrieveRecord, createRecord, updateRecord, deleteRecord, execute };
}
export function deferredData() {
  let resolve: (value: unknown) => void = () => { throw new Error("Not initialized"); };
  let reject: (reason: unknown) => void = () => { throw new Error("Not initialized"); };
  const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
