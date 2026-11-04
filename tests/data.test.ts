import { afterEach, describe, expect, it, vi } from "vitest";
import { Data } from "../src/data.js";
import { VbdError } from "../src/errors.js";
import { dataFixture, deferredData, id, odata, otherId, ref } from "./data-fixture.js";

afterEach(() => vi.unstubAllGlobals());
describe("selected, scoped data reads", () => {
  it("normalizes references, requires selected columns, and preserves ETags", async () => {
    const host = dataFixture();
    const result = await Data.retrieve({ entityType: "ACCOUNT", id: `{${id.toUpperCase()}}` }, ["name"], host.client);
    expect(result).toEqual({ name: "Synthetic", "@odata.etag": 'W/"1"' });
    expect(host.retrieveRecord).toHaveBeenCalledWith("account", id, "?$select=name");
    for (const columns of [[], ["name", "name"], ["name&$expand=secret"], Array.from({ length: 101 }, (_, i) => `f${i}`)]) {
      await expect(Data.retrieve(ref, columns, host.client)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    }
    expect(host.retrieveRecord).toHaveBeenCalledTimes(1);
  });
  it.each([null, [], 1, { name: undefined }, { "@odata.etag": "bad" }])("rejects malformed rows %j", async (value) => {
    const host = dataFixture();
    host.retrieveRecord.mockResolvedValue(value);
    await expect(Data.retrieve(ref, ["name"], host.client)).rejects.toMatchObject({ code: "DATA_RESPONSE_INVALID" });
  });
  it("uses the online SDK lazily and keeps method receivers", async () => {
    const host = dataFixture();
    vi.stubGlobal("Xrm", {
      Utility: { getGlobalContext: () => ({
        getClientUrl: () => host.scope.environmentUrl,
        userSettings: { userId: id, languageId: 1033 },
        client: { getClientState: () => "Online" }
      }) },
      WebApi: { retrieveMultipleRecords: host.retrieveMultipleRecords,
        online: { retrieveRecord: host.retrieveRecord, retrieveMultipleRecords: host.retrieveMultipleRecords } }
    });
    await expect(Data.retrieve(ref, ["name"])).resolves.toMatchObject({ name: "Synthetic" });
    vi.stubGlobal("Xrm", undefined);
    await expect(Data.retrieve(ref, ["name"])).rejects.toMatchObject({ code: "UNSUPPORTED_SURFACE" });
  });
  it("keeps denied, not-found, invalid table and transport reads distinct from no match", async () => {
    const host = dataFixture();
    const query = { entitySet: "accounts", select: ["name"], filter: "name eq 'Synthetic'" };
    expect(await Data.exists("account", query, host.client)).toBe(false);
    host.retrieveMultipleRecords.mockResolvedValue({ entities: [{ name: "Synthetic" }] });
    expect(await Data.exists("account", query, host.client)).toBe(true);
    for (const [status, code] of [[401, "ACCESS_DENIED"], [403, "ACCESS_DENIED"], [404, "DATA_READ_FAILED"],
      [400, "DATA_READ_FAILED"], [503, "DATA_READ_FAILED"]] as const) {
      const cause = { status, message: "private details" };
      host.retrieveMultipleRecords.mockRejectedValue(cause);
      await expect(Data.exists("account", query, host.client)).rejects.toMatchObject({ code, cause });
    }
    host.retrieveRecord.mockRejectedValue({ status: 404 });
    await expect(Data.retrieve(ref, ["name"], host.client)).rejects.toMatchObject({ code: "DATA_READ_FAILED", cause: { status: 404 } });
  });
  it("delegates retrieveMany as one bounded page", async () => {
    const host = dataFixture();
    expect(await Data.retrieveMany("account", odata, host.client)).toEqual({ records: [], complete: true });
    expect(host.retrieveMultipleRecords).toHaveBeenCalledWith("account", "?$select=name", 2);
  });
  it.each(["userId", "environmentUrl", "languageId", "online"] as const)("checks %s after await", async (field) => {
    const host = dataFixture();
    const waiting = deferredData();
    host.retrieveRecord.mockReturnValue(waiting.promise);
    const pending = Data.retrieve(ref, ["name"], host.client);
    if (field === "userId") { host.scope.userId = otherId; }
    if (field === "environmentUrl") { host.scope.environmentUrl = "https://elsewhere.example"; }
    if (field === "languageId") { host.scope.languageId = 1043; }
    if (field === "online") { host.scope.online = false; }
    waiting.resolve({ name: "Synthetic" });
    await expect(pending).rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
  });
  it("rejects invalid/offline scope before dispatch", async () => {
    const host = dataFixture();
    host.scope.online = false;
    await expect(Data.retrieve(ref, ["name"], host.client)).rejects.toMatchObject({ code: "UNSUPPORTED_SURFACE" });
    expect(host.retrieveRecord).not.toHaveBeenCalled();
  });
  it("checks scope after runtime response validation as well as after await", async () => {
    const host = dataFixture();
    host.retrieveRecord.mockResolvedValue({
      get name() { host.scope.userId = otherId; return "not returned"; }
    });
    await expect(Data.retrieve(ref, ["name"], host.client)).rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
  });
});
describe("explicit bounded mutations", () => {
  it("creates and updates supplied scalar field allowlists only", async () => {
    const host = dataFixture();
    expect(await Data.create("ACCOUNT", { name: "Synthetic", revenue: 0, active: false, note: null },
      { allowedFields: ["name", "revenue", "active", "note"], context: host.context })).toEqual(ref);
    expect(await Data.update(ref, { name: "Changed" }, { allowedFields: ["name"], context: host.context })).toEqual(ref);
    expect(host.createRecord).toHaveBeenCalledTimes(1);
    expect(host.updateRecord).toHaveBeenCalledWith("account", id, { name: "Changed" });
  });
  it.each([
    {}, { unknown: "x" }, { "name@odata.bind": "/accounts(fake)" }, { _ownerid_value: id },
    { createdon: "2020-01-01" }, { name: undefined }, { name: Infinity }, { name: new Date() },
    { name: ["deep insert"] }, { name: { nested: "deep" } }, { name: "x".repeat(65_537) }
  ])("rejects unsafe payload %j before writes", async (payload) => {
    const host = dataFixture();
    await expect(Data.create("account", payload as never,
      { allowedFields: ["name", "createdon"], context: host.context })).rejects.toBeInstanceOf(VbdError);
    expect(host.createRecord).not.toHaveBeenCalled();
  });
  it("rejects unsafe prototypes, cycles, and annotation/system-response payloads", async () => {
    const host = dataFixture();
    const cyclic: Record<string, unknown> = {};
    cyclic.name = cyclic;
    const unsafe = Object.fromEntries([["__proto__", "x"]]);
    for (const payload of [cyclic, unsafe, { "@odata.etag": 'W/"1"', name: "copy" }]) {
      await expect(Data.update(ref, payload as never, { allowedFields: ["name"], context: host.context }))
        .rejects.toBeInstanceOf(VbdError);
    }
    expect(host.updateRecord).not.toHaveBeenCalled();
  });
  it("requires deliberate exact-target delete confirmation", async () => {
    const host = dataFixture();
    for (const options of [{}, { policy: "confirm-delete", confirmation: { ...ref, id: otherId } },
      { policy: "confirm-delete", confirmation: ref, etag: 'W/"1"' }]) {
      await expect(Data.delete(ref, { ...options, context: host.context } as never))
        .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    }
    expect(host.deleteRecord).not.toHaveBeenCalled();
    expect(await Data.delete(ref, { policy: "confirm-delete", confirmation: ref, context: host.context })).toEqual(ref);
  });
  it("rejects ETags on native update; uses an explicitly supplied atomic adapter", async () => {
    const host = dataFixture();
    const options = { allowedFields: ["name"], etag: 'W/"10"', context: host.context };
    await expect(Data.update(ref, { name: "new" }, options)).rejects.toMatchObject({ code: "UNSUPPORTED_SURFACE" });
    expect(host.updateRecord).not.toHaveBeenCalled();
    const conditional = vi.fn().mockResolvedValue(ref);
    host.context.updateRecordConditional = conditional;
    expect(await Data.update(ref, { name: "new" }, options)).toEqual(ref);
    expect(conditional).toHaveBeenCalledWith(ref, { name: "new" }, 'W/"10"');
    conditional.mockRejectedValue({ status: 412 });
    await expect(Data.update(ref, { name: "new" }, options)).rejects.toMatchObject({ code: "CONCURRENCY_CONFLICT" });
    expect(conditional).toHaveBeenCalledTimes(2);
    await expect(Data.update(ref, { name: "new" }, { ...options, etag: "*" }))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });
  it.each([undefined, null, {}, { entityType: "wrong", id }, { entityType: "account", id: "bad" }])(
    "reports uncertain write response %j, never successful empty fallback", async (response) => {
      const host = dataFixture();
      host.createRecord.mockResolvedValue(response);
      await expect(Data.create("account", { name: "new" }, { allowedFields: ["name"], context: host.context }))
        .rejects.toMatchObject({ code: "MUTATION_OUTCOME_UNKNOWN" });
      expect(host.createRecord).toHaveBeenCalledTimes(1);
    });
  it.each([[403, "ACCESS_DENIED"], [400, "DATA_WRITE_FAILED"], [500, "MUTATION_OUTCOME_UNKNOWN"],
    [undefined, "MUTATION_OUTCOME_UNKNOWN"]] as const)("classifies failed write %s without retry", async (status, code) => {
    const host = dataFixture();
    const cause = { status, message: "PRIVATE TOKEN" };
    host.updateRecord.mockRejectedValue(cause);
    const pending = Data.update(ref, { name: "new" }, { allowedFields: ["name"], context: host.context });
    await expect(pending).rejects.toMatchObject({ code, cause });
    await expect(pending).rejects.not.toThrow("PRIVATE TOKEN");
    expect(host.updateRecord).toHaveBeenCalledTimes(1);
  });
  it("does not claim rollback when scope changes after a write", async () => {
    const host = dataFixture();
    const waiting = deferredData();
    host.deleteRecord.mockReturnValue(waiting.promise);
    const pending = Data.delete(ref, { policy: "confirm-delete", confirmation: ref, context: host.context });
    host.scope.userId = otherId;
    waiting.resolve(ref);
    await expect(pending).rejects.toMatchObject({ code: "MUTATION_OUTCOME_UNKNOWN" });
    expect(host.deleteRecord).toHaveBeenCalledTimes(1);
  });
  it("does not mistake a rejected operation across scope change for a known rollback", async () => {
    const host = dataFixture();
    const waiting = deferredData();
    host.createRecord.mockReturnValue(waiting.promise);
    const pending = Data.create("account", { name: "Synthetic" }, { allowedFields: ["name"], context: host.context });
    host.scope.environmentUrl = "https://other.example";
    waiting.reject({ status: 403, message: "private" });
    await expect(pending).rejects.toMatchObject({ code: "MUTATION_OUTCOME_UNKNOWN" });
    expect(host.createRecord).toHaveBeenCalledTimes(1);
  });
});
describe("explicit related-record metadata", () => {
  const settings = { navigationProperty: "contacts", cardinality: "collection" as const,
    rootColumns: ["name"], columns: ["fullname"], maximum: 2 };
  it("selects explicit root/related columns and reports collection truncation", async () => {
    const host = dataFixture();
    host.retrieveRecord.mockResolvedValue({ contacts: [{ fullname: "A" }, { fullname: "B" }, { fullname: "C" }] });
    expect(await Data.retrieveRelated(ref, settings, host.client)).toEqual({
      kind: "collection", records: [{ fullname: "A" }, { fullname: "B" }], complete: false, reason: "limit"
    });
    expect(host.retrieveRecord).toHaveBeenCalledWith("account", id,
      "?$select=name&$expand=contacts($select=fullname;$top=3)");
  });
  it("reports unsupported expanded paging rather than guessing a route", async () => {
    const host = dataFixture();
    host.retrieveRecord.mockResolvedValue({ contacts: [{ fullname: "A" }], "contacts@odata.nextLink": "opaque" });
    expect(await Data.retrieveRelated(ref, settings, host.client))
      .toMatchObject({ complete: false, reason: "unsupportedContinuation" });
  });
  it("accepts a related single record or genuine null and rejects cardinality mismatch", async () => {
    const host = dataFixture();
    const single = { ...settings, cardinality: "single" as const };
    host.retrieveRecord.mockResolvedValue({ contacts: null });
    expect(await Data.retrieveRelated(ref, single, host.client)).toEqual({ kind: "single", record: null });
    host.retrieveRecord.mockResolvedValue({ contacts: { fullname: "A" } });
    expect(await Data.retrieveRelated(ref, single, host.client)).toMatchObject({ record: { fullname: "A" } });
    host.retrieveRecord.mockResolvedValue({ contacts: [] });
    await expect(Data.retrieveRelated(ref, single, host.client)).rejects.toMatchObject({ code: "DATA_RESPONSE_INVALID" });
    await expect(Data.retrieveRelated(ref, { ...settings, rootColumns: [] }, host.client))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });
  it("bounds collections at exactly 1000 and detects an extra result", async () => {
    const host = dataFixture();
    host.retrieveRecord.mockResolvedValue({ contacts: Array.from({ length: 1001 }, () => ({ fullname: "Synthetic" })) });
    const result = await Data.retrieveRelated(ref, { ...settings, maximum: 1000 }, host.client);
    expect(result.kind).toBe("collection");
    if (result.kind !== "collection") { throw new Error("Wrong cardinality"); }
    expect(result.records).toHaveLength(1000);
    expect(result.complete).toBe(false);
    for (const maximum of [0, 1001]) {
      await expect(Data.retrieveRelated(ref, { ...settings, maximum }, host.client))
        .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    }
    expect(host.retrieveRecord).toHaveBeenCalledTimes(1);
  });
});

describe("OData lookup-shadow reads remain separate from mutations", () => {
  it("selects lookup shadows in retrieve, exists, and related root/expanded records", async () => {
    const host = dataFixture();
    host.retrieveRecord.mockResolvedValue({ _ownerid_value: otherId, _parentcustomerid_value: id });
    expect(await Data.retrieve(ref, ["_OWNERID_VALUE", "_parentcustomerid_value"], host.client))
      .toEqual({ _ownerid_value: otherId, _parentcustomerid_value: id });
    expect(host.retrieveRecord).toHaveBeenLastCalledWith("account", id, "?$select=_ownerid_value,_parentcustomerid_value");
    host.retrieveMultipleRecords.mockResolvedValue({ entities: [{ _ownerid_value: otherId }] });
    expect(await Data.exists("account", {
      entitySet: "accounts", select: ["_ownerid_value"], filter: `_ownerid_value eq ${otherId}`
    }, host.client)).toBe(true);
    expect(host.retrieveMultipleRecords.mock.calls[0]?.[1]).toContain("$select=_ownerid_value");
    host.retrieveRecord.mockResolvedValue({ primarycontactid: { _ownerid_value: otherId } });
    expect(await Data.retrieveRelated(ref, {
      navigationProperty: "primarycontactid", cardinality: "single",
      rootColumns: ["_parentcustomerid_value"], columns: ["_ownerid_value"], maximum: 1
    }, host.client)).toEqual({ kind: "single", record: { _ownerid_value: otherId } });
    expect(host.retrieveRecord).toHaveBeenLastCalledWith("account", id,
      "?$select=_parentcustomerid_value&$expand=primarycontactid($select=_ownerid_value)");
  });
  it.each([
    "_ownerid_value", "_parentcustomerid_value", "_ownerid_value@OData.Community.Display.V1.FormattedValue",
    "ownerid@odata.bind", "@odata.etag"
  ])("rejects mutation key %s even when explicitly present in the field allowlist", async (key) => {
    const host = dataFixture();
    const options = { allowedFields: [key], context: host.context };
    await expect(Data.create("account", { [key]: otherId }, options)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(Data.update(ref, { [key]: otherId }, options)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(host.createRecord).not.toHaveBeenCalled();
    expect(host.updateRecord).not.toHaveBeenCalled();
  });
});
