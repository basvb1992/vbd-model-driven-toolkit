import { describe, expect, it } from "vitest";
import { Query } from "../src/query.js";
import type { FilterNode, FilterPolicy, QuerySpecification } from "../src/query.js";
import { checkedXml } from "../src/xml.js";
import { dataFixture, deferredData, fetchCookie, fetchXml, id, nextLink, odata, otherId } from "./data-fixture.js";

const spec: QuerySpecification = { kind: "odata", table: "account", options: odata };
const bounds = { maxPages: 5, maxRecords: 10 };
describe("bounded one-page OData", () => {
  it("encodes values as data and accepts structured order/expands", async () => {
    const host = dataFixture();
    await Query.executeOData("account", { ...odata, top: 2, filter: "name eq 'A&B'",
      orderBy: [{ column: "name", direction: "desc" }],
      expand: [{ navigationProperty: "primarycontactid", select: ["fullname"], top: 1 }] }, host.client);
    const query = host.retrieveMultipleRecords.mock.calls[0]?.[1];
    expect(query).toContain("$filter=name%20eq%20'A%26B'");
    expect(query).toContain("$orderby=name%20desc");
    expect(query).toContain("$expand=primarycontactid");
    expect(query).toContain("$top=2");
  });
  it.each([
    { pageSize: 0 }, { pageSize: 5001 }, { select: [] }, { select: ["name&x"] },
    { select: ["name", "name"] }, { entitySet: "" }, { entitySet: "accounts/other" },
    { filter: "" }, { top: 3 }, { skip: 1 }, { orderBy: [] }, { expand: [] },
    { orderBy: [{ column: "name", direction: "sideways" }] },
    { expand: [{ navigationProperty: "contacts", select: [], top: 1 }] }
  ])("rejects malformed option shapes %j before read", async (changes) => {
    const host = dataFixture();
    await expect(Query.executeOData("account", { ...odata, ...changes } as never, host.client))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(host.retrieveMultipleRecords).not.toHaveBeenCalled();
  });
  it("accepts page sizes exactly 1 and 5000", async () => {
    const host = dataFixture();
    for (const pageSize of [1, 5000]) {
      await Query.executeOData("account", { ...odata, pageSize }, host.client);
      expect(host.retrieveMultipleRecords.mock.calls.at(-1)?.[2]).toBe(pageSize);
    }
  });
  it.each([null, {}, { entities: null }, { entities: [null] }, { entities: [{}, {}, {}] },
    { entities: [], nextLink: "" }, { entities: [], nextLink: nextLink() },
    { entities: [], fetchXmlPagingCookie: fetchCookie() }])("rejects malformed response %j", async (response) => {
    const host = dataFixture();
    host.retrieveMultipleRecords.mockResolvedValue(response);
    await expect(Query.executeOData("account", odata, host.client)).rejects.toMatchObject({ code: "DATA_RESPONSE_INVALID" });
  });
  it("follows a same-environment continuation without re-encoding or changing page size", async () => {
    const host = dataFixture();
    const next = nextLink("<cookie pagenumber=\"2\" pagingcookie=\"%253c\"/>");
    host.retrieveMultipleRecords
      .mockResolvedValueOnce({ entities: [{ name: "A" }, { name: "B" }], nextLink: next })
      .mockResolvedValueOnce({ entities: [{ name: "C" }] });
    const result = await Query.retrieveAll(spec, bounds, host.client);
    expect(result).toMatchObject({ records: [{ name: "A" }, { name: "B" }, { name: "C" }],
      complete: true, reason: "complete", pages: 2 });
    expect(host.retrieveMultipleRecords.mock.calls[1]).toEqual(["account", new URL(next).search, 2]);
  });
  it.each([
    "https://foreign.example/api/data/v9.2/accounts?$select=name&$skiptoken=x",
    "https://tenant.example.evil.example/api/data/v9.2/accounts?$select=name&$skiptoken=x",
    "https://user:pass@tenant.example/api/data/v9.2/accounts?$select=name&$skiptoken=x",
    "https://tenant.example/api/data/v9.2/contacts?$select=name&$skiptoken=x",
    "https://tenant.example/api/data/v9.2/accounts(111)?$select=name&$skiptoken=x",
    "/api/data/v9.2/accounts?$select=name&$skiptoken=x",
    "?$select=name&$skiptoken=x",
    "https://tenant.example/api/data/v9.2/accounts?$select=name&$skip=20",
    "https://tenant.example/api/data/v9.2/accounts?$select=secret&$skiptoken=x",
    "https://tenant.example/api/data/v9.2/accounts?$select=name&$skiptoken=x&$skiptoken=y",
    "https://tenant.example/api/data/v9.2/accounts?$select=name&$skiptoken=x#secret",
    "https://tenant.example/api/data/v9.2/accounts?$select=name&$skiptoken=x&$expand=secret",
    "https://tenant.example\\@foreign.example/api/data/v9.2/accounts?$select=name&$skiptoken=x"
  ])("rejects malicious/unsupported nextLink %s", async (next) => {
    const host = dataFixture();
    host.retrieveMultipleRecords.mockResolvedValue({ entities: [{ name: "A" }], nextLink: next });
    await expect(Query.executeOData("account", odata, host.client)).rejects.toMatchObject({ code: "DATA_RESPONSE_INVALID" });
    expect(host.retrieveMultipleRecords).toHaveBeenCalledTimes(1);
  });
  it("rejects repeated continuation even if URL parameter order changes", async () => {
    const host = dataFixture();
    host.retrieveMultipleRecords
      .mockResolvedValueOnce({ entities: [{ name: "A" }], nextLink: nextLink() })
      .mockResolvedValueOnce({ entities: [{ name: "B" }],
        nextLink: "https://tenant.example/api/data/v9.2/accounts?$skiptoken=next&$select=name" });
    await expect(Query.retrieveAll(spec, bounds, host.client)).rejects.toMatchObject({ code: "DATA_RESPONSE_INVALID" });
    expect(host.retrieveMultipleRecords).toHaveBeenCalledTimes(2);
  });
});
describe("finite iteration, scope, cancellation and resumption", () => {
  it("reports exact maxPages truncation and supports an opaque continuation", async () => {
    const host = dataFixture();
    host.retrieveMultipleRecords
      .mockResolvedValueOnce({ entities: [{ name: "A" }, { name: "B" }], nextLink: nextLink() })
      .mockResolvedValueOnce({ entities: [{ name: "C" }] });
    const result = await Query.retrieveAll(spec, { maxPages: 1, maxRecords: 10 }, host.client);
    expect(result).toMatchObject({ complete: false, reason: "maxPages", pages: 1 });
    expect(host.retrieveMultipleRecords).toHaveBeenCalledTimes(1);
    if (!result.continuation) { throw new Error("Missing continuation"); }
    expect(await Query.retrieveAll({ kind: "continuation", continuation: result.continuation }, bounds, host.client))
      .toMatchObject({ complete: true, records: [{ name: "C" }] });
  });
  it("retains a partial page in an opaque cursor, without losing or rereading records", async () => {
    const host = dataFixture();
    host.retrieveMultipleRecords
      .mockResolvedValueOnce({ entities: [{ name: "A" }, { name: "B" }], nextLink: nextLink() })
      .mockResolvedValueOnce({ entities: [{ name: "C" }] });
    const first = await Query.retrieveAll(spec, { maxPages: 5, maxRecords: 1 }, host.client);
    expect(first).toMatchObject({ complete: false, reason: "maxRecords", records: [{ name: "A" }] });
    if (!first.continuation) { throw new Error("Missing continuation"); }
    const rest = await Query.retrieveAll({ kind: "continuation", continuation: first.continuation }, bounds, host.client);
    expect(rest).toMatchObject({ complete: true, records: [{ name: "B" }, { name: "C" }] });
    expect(host.retrieveMultipleRecords).toHaveBeenCalledTimes(2);
    expect(host.retrieveMultipleRecords.mock.calls.every((call) => call[2] === 2)).toBe(true);
  });
  it("does not call an exact complete threshold truncated", async () => {
    const host = dataFixture();
    host.retrieveMultipleRecords.mockResolvedValue({ entities: [{ name: "A" }, { name: "B" }] });
    expect(await Query.retrieveAll(spec, { maxPages: 1, maxRecords: 2 }, host.client))
      .toMatchObject({ complete: true, reason: "complete" });
  });
  it.each([
    { maxPages: 0, maxRecords: 1 }, { maxPages: 101, maxRecords: 1 }, { maxPages: 1, maxRecords: 0 },
    { maxPages: 1, maxRecords: 100001 }, { maxPages: 1.5, maxRecords: 1 },
    { maxPages: 1, maxRecords: 1, signal: { aborted: false } }, { maxPages: 1, maxRecords: 1, extra: true }
  ])("rejects malformed/over-limit iteration bounds %j", async (settings) => {
    const host = dataFixture();
    await expect(Query.retrieveAll(spec, settings as never, host.client)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(host.retrieveMultipleRecords).not.toHaveBeenCalled();
  });
  it("accepts exact maximum iteration bounds", async () => {
    const host = dataFixture();
    expect(await Query.retrieveAll(spec, { maxPages: 100, maxRecords: 100000 }, host.client))
      .toMatchObject({ complete: true });
  });
  it("reports pre-cancellation without requests", async () => {
    const host = dataFixture();
    const controller = new AbortController();
    controller.abort();
    expect(await Query.retrieveAll(spec, { ...bounds, signal: controller.signal }, host.client))
      .toMatchObject({ complete: false, reason: "cancelled", records: [], pages: 0 });
    expect(host.retrieveMultipleRecords).not.toHaveBeenCalled();
  });
  it("reports in-flight cancellation and sends no next request", async () => {
    const host = dataFixture();
    const waiting = deferredData();
    const controller = new AbortController();
    host.retrieveMultipleRecords.mockReturnValue(waiting.promise);
    const pending = Query.retrieveAll(spec, { ...bounds, signal: controller.signal }, host.client);
    controller.abort();
    waiting.resolve({ entities: [{ name: "A" }], nextLink: nextLink() });
    expect(await pending).toMatchObject({ complete: false, reason: "cancelled", records: [{ name: "A" }] });
    expect(host.retrieveMultipleRecords).toHaveBeenCalledTimes(1);
  });
  it("binds the whole invocation across generator yields and rejects forged or cross-user continuations", async () => {
    const host = dataFixture();
    host.retrieveMultipleRecords.mockResolvedValue({ entities: [{ name: "A" }], nextLink: nextLink() });
    const generator = Query.iteratePages(spec, bounds, host.client);
    const first = await generator.next();
    host.scope.userId = otherId;
    await expect(generator.next()).rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
    expect(host.retrieveMultipleRecords).toHaveBeenCalledTimes(1);
    if (!first.value?.continuation) { throw new Error("Missing continuation"); }
    await expect(Query.retrieveAll({ kind: "continuation", continuation: first.value.continuation }, bounds, host.client))
      .rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
    await expect(Query.retrieveAll({ kind: "continuation", continuation: { kind: "odata" } }, bounds, host.client))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });
});
describe("FetchXML selected-root subset and supported cookie semantics", () => {
  it("requires selection, matching table, and explicit order; rejects raw paging/joins/aggregate", async () => {
    const host = dataFixture();
    for (const xml of [
      '<fetch><entity name="account"/></fetch>',
      fetchXml.replace('name="account"', 'name="contact"'),
      fetchXml.replace('<order attribute="accountid"/>', ""),
      fetchXml.replace("<fetch>", '<fetch page="2">'),
      fetchXml.replace('<attribute name="name"/>', "<all-attributes/>"),
      fetchXml.replace('<attribute name="name"/>', '<attribute name="name" aggregate="count"/>'),
      fetchXml.replace("</entity>", '<link-entity name="contact"/></entity>'),
      '<!DOCTYPE fetch [<!ENTITY x "x">]>' + fetchXml,
      '<fetch><entity></fetch>'
    ]) {
      await expect(Query.executeFetchXml("account", { xml, pageSize: 2 }, host.client))
        .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    }
    expect(host.retrieveMultipleRecords).not.toHaveBeenCalled();
  });
  it("roundtrips cookie/entity values exactly once without DOM or double escaping", async () => {
    const host = dataFixture();
    host.retrieveMultipleRecords
      .mockResolvedValueOnce({ entities: [{ name: "A" }, { name: "B" }], fetchXmlPagingCookie: fetchCookie() })
      .mockResolvedValueOnce({ entities: [{ name: "C" }] });
    expect(await Query.retrieveAll({ kind: "fetchxml", table: "account", options: {
      xml: fetchXml.replace("</entity>", '<filter><condition attribute="name" operator="eq" value="A&amp;B"/></filter></entity>'),
      pageSize: 2
    } }, bounds, host.client)).toMatchObject({ complete: true, pages: 2 });
    const sent = host.retrieveMultipleRecords.mock.calls[1]?.[1];
    if (!sent) { throw new Error("Missing query"); }
    const parsed = checkedXml(sent.slice("?fetchXml=".length), "fetch");
    expect(parsed.root["@_page"]).toBe("2");
    expect(parsed.root["@_paging-cookie"]).toBe('<cookie page="1"><accountid last="A&amp;B"/></cookie>');
    // The cookie is XML inside an XML attribute: the outer entity layer is necessary.
    // Ordinary filter values have exactly one layer.
    expect(sent).toContain('value="A&amp;B"');
  });
  it.each([
    "<cookie/>", "<cookie pagenumber=\"3\" pagingcookie=\"bad\"/>",
    "<cookie pagenumber=\"2\" pagingcookie=\"%ZZ\"/>",
    '<!DOCTYPE cookie [<!ENTITY bad "x">]><cookie/>',
    '<cookie pagenumber="2" pagingcookie="x"/><cookie/>'
  ])("rejects malformed/ambiguous cookies %s", async (cookie) => {
    const host = dataFixture();
    host.retrieveMultipleRecords.mockResolvedValue({ entities: [{ name: "A" }], fetchXmlPagingCookie: cookie });
    await expect(Query.executeFetchXml("account", { xml: fetchXml, pageSize: 2 }, host.client))
      .rejects.toMatchObject({ code: "DATA_RESPONSE_INVALID" });
  });
  it("fails explicitly for a full page without supported cookie rather than claiming completion", async () => {
    const host = dataFixture();
    host.retrieveMultipleRecords.mockResolvedValue({ entities: [{ name: "A" }, { name: "B" }] });
    await expect(Query.executeFetchXml("account", { xml: fetchXml, pageSize: 2 }, host.client))
      .rejects.toMatchObject({ code: "UNSUPPORTED_SURFACE" });
  });
});
describe("allowlisted structural filters", () => {
  const policy: FilterPolicy = { columns: { name: "string", count: "number", active: "boolean", id: "guid", date: "date" },
    operators: ["eq", "ne", "gt", "ge", "lt", "le", "contains", "in"], format: "odata" };
  it("escapes apostrophes/XML data and formats booleans, dates, GUIDs and null", () => {
    expect(Query.buildFilter({ kind: "condition", column: "name", operator: "eq", value: "O'Brien & <X>" }, policy))
      .toBe("name eq 'O''Brien & <X>'");
    expect(Query.buildFilter({ kind: "condition", column: "name", operator: "eq", value: "A&B" },
      { ...policy, format: "fetchxml" })).toContain('value="A&amp;B"');
    expect(Query.buildFilter({ kind: "condition", column: "active", operator: "eq", value: false }, policy)).toBe("active eq false");
    expect(Query.buildFilter({ kind: "condition", column: "name", operator: "eq", value: null },
      { ...policy, format: "fetchxml" })).toContain('operator="null"');
    expect(Query.buildFilter({ kind: "condition", column: "date", operator: "ge", value: new Date("2020-01-01Z") }, policy))
      .toBe("date ge 2020-01-01T00:00:00.000Z");
  });
  it("supports AND/OR/NOT and bounded IN with no raw structure", () => {
    expect(Query.buildFilter({ kind: "not", condition: { kind: "or", conditions: [
      { kind: "condition", column: "count", operator: "gt", value: 1 },
      { kind: "condition", column: "name", operator: "in", value: ["A", "B"] }
    ] } }, policy)).toBe("not ((count gt 1 or (name eq 'A' or name eq 'B')))");
  });
  it.each([
    { kind: "raw", text: "name eq 'x'" },
    { kind: "condition", column: "name or true", operator: "eq", value: "x" },
    { kind: "condition", column: "secret", operator: "eq", value: "x" },
    { kind: "condition", column: "name", operator: "bad", value: "x" },
    { kind: "condition", column: "count", operator: "eq", value: "1" },
    { kind: "condition", column: "name", operator: "gt", value: null },
    { kind: "condition", column: "name", operator: "in", value: [] },
    { kind: "condition", column: "name", operator: "in", value: [null] }
  ])("rejects invalid structural filter %j", (node) => {
    expect(() => Query.buildFilter(node as never, policy)).toThrow();
  });
  it("requires allowlisted operators and explicitly rejects unsupported XML NOT/contains", () => {
    const node: FilterNode = { kind: "condition", column: "name", operator: "contains", value: "%" };
    expect(() => Query.buildFilter(node, { ...policy, operators: ["eq"] })).toThrow();
    expect(() => Query.buildFilter(node, { ...policy, format: "fetchxml" })).toThrow();
    expect(() => Query.buildFilter({ kind: "not", condition: node }, { ...policy, format: "fetchxml" })).toThrow();
  });
  it("bounds depth at 8, nodes at 100, and in-lists at 100; rejects cycles", () => {
    const leaf: FilterNode = { kind: "condition", column: "count", operator: "eq", value: 1 };
    let node: FilterNode = leaf;
    for (let depth = 0; depth < 8; depth++) { node = { kind: "not", condition: node }; }
    expect(() => Query.buildFilter(node, policy)).not.toThrow();
    expect(() => Query.buildFilter({ kind: "not", condition: node }, policy)).toThrow();
    expect(() => Query.buildFilter({ kind: "and", conditions: Array.from({ length: 99 }, () => leaf) }, policy)).not.toThrow();
    expect(() => Query.buildFilter({ kind: "and", conditions: Array.from({ length: 100 }, () => leaf) }, policy)).toThrow();
    for (const size of [100, 101]) {
      const call = () => Query.buildFilter({ kind: "condition", column: "count", operator: "in",
        value: Array.from({ length: size }, (_, i) => i) }, policy);
      if (size === 100) { expect(call).not.toThrow(); } else { expect(call).toThrow(); }
    }
    const cycle: { kind: "not"; condition: FilterNode } = { kind: "not", condition: leaf };
    cycle.condition = cycle;
    expect(() => Query.buildFilter(cycle, policy)).toThrow();
  });
});

describe("format-specific lookup read properties", () => {
  const policy: FilterPolicy = {
    format: "odata", columns: { _ownerid_value: "guid", _parentcustomerid_value: "guid" }, operators: ["eq", "in"]
  };
  it("selects, orders, expands, and filters supported OData lookup shadows", async () => {
    const host = dataFixture();
    const filter = Query.buildFilter({
      kind: "and", conditions: [
        { kind: "condition", column: "_ownerid_value", operator: "eq", value: id },
        { kind: "condition", column: "_parentcustomerid_value", operator: "in", value: [id, otherId] }
      ]
    }, policy);
    expect(filter).toBe(`(_ownerid_value eq ${id} and (_parentcustomerid_value eq ${id} or _parentcustomerid_value eq ${otherId}))`);
    host.retrieveMultipleRecords.mockResolvedValue({ entities: [{ _ownerid_value: id }] });
    expect(await Query.executeOData("account", {
      ...odata, select: ["name", "_OWNERID_VALUE", "_parentcustomerid_value"], filter,
      orderBy: [{ column: "_OWNERID_VALUE", direction: "desc" }],
      expand: [{ navigationProperty: "primarycontactid", select: ["_ownerid_value"], top: 1 }]
    }, host.client)).toMatchObject({ complete: true, records: [{ _ownerid_value: id }] });
    const query = host.retrieveMultipleRecords.mock.calls[0]?.[1];
    if (!query) { throw new Error("Missing query"); }
    const options = new URLSearchParams(query);
    expect(options.get("$select")).toBe("name,_ownerid_value,_parentcustomerid_value");
    expect(options.get("$orderby")).toBe("_ownerid_value desc");
    expect(options.get("$expand")).toBe("primarycontactid($select=_ownerid_value;$top=1)");
    expect(options.get("$filter")).toBe(filter);
  });
  it.each([
    "_ownerid", "_value", "_1ownerid_value", "__ownerid_value", "_ownerid_value_",
    "_owner.id_value", "_ownerid_value/secret", "_ownerid_value&$select=secret",
    "_ownerid_value desc", "_ownerid_value@odata.bind", "_ownerid_value) or true", " _ownerid_value",
    `_${"a".repeat(129)}_value`
  ])("rejects malformed or structural lookup property %s", async (column) => {
    const host = dataFixture();
    await expect(Query.executeOData("account", { ...odata, select: [column] }, host.client))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(Query.executeOData("account", { ...odata, orderBy: [{ column, direction: "asc" }] }, host.client))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(() => Query.buildFilter({ kind: "condition", column, operator: "eq", value: id },
      { ...policy, columns: { [column]: "guid" } })).toThrow();
    expect(host.retrieveMultipleRecords).not.toHaveBeenCalled();
  });
  it("preserves lookup identifier, case-normalized duplicate, and explicit allowlist boundaries", async () => {
    const host = dataFixture();
    const column = `_${"a".repeat(128)}_value`;
    expect(column).toHaveLength(135);
    await expect(Query.executeOData("account", {
      ...odata, select: [column], orderBy: [{ column, direction: "asc" }]
    }, host.client)).resolves.toMatchObject({ complete: true });
    expect(Query.buildFilter({ kind: "condition", column, operator: "eq", value: id },
      { ...policy, columns: { [column]: "guid" } })).toBe(`${column} eq ${id}`);
    await expect(Query.executeOData("account", { ...odata, select: ["_ownerid_value", "_OWNERID_VALUE"] }, host.client))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(() => Query.buildFilter({
      kind: "condition", column: "_anotherlookup_value", operator: "eq", value: id
    }, policy)).toThrow();
    await expect(Query.executeOData("_ownerid_value", odata, host.client))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(host.retrieveMultipleRecords).toHaveBeenCalledTimes(1);
  });
  it("keeps FetchXML selections, order and filters logical-name-only", async () => {
    const host = dataFixture();
    const xml = `<fetch><entity name="account"><attribute name="ownerid"/><order attribute="ownerid"/><filter><condition attribute="ownerid" operator="eq" value="${id}"/></filter></entity></fetch>`;
    await expect(Query.executeFetchXml("account", { xml, pageSize: 2 }, host.client))
      .resolves.toMatchObject({ complete: true });
    for (const invalid of [
      xml.replace('<attribute name="ownerid"', '<attribute name="_ownerid_value"'),
      xml.replace('<order attribute="ownerid"', '<order attribute="_ownerid_value"'),
      xml.replace('<condition attribute="ownerid"', '<condition attribute="_ownerid_value"')
    ]) {
      await expect(Query.executeFetchXml("account", { xml: invalid, pageSize: 2 }, host.client))
        .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    }
    expect(Query.buildFilter({ kind: "condition", column: "ownerid", operator: "eq", value: id },
      { format: "fetchxml", columns: { ownerid: "guid" }, operators: ["eq"] }))
      .toContain(`<condition attribute="ownerid" operator="eq" value="${id}"/>`);
    expect(() => Query.buildFilter({
      kind: "condition", column: "_ownerid_value", operator: "eq", value: id
    }, { ...policy, format: "fetchxml" })).toThrow();
    expect(host.retrieveMultipleRecords).toHaveBeenCalledTimes(1);
  });
});
