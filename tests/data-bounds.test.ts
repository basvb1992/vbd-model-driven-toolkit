import { describe, expect, it } from "vitest";
import { Data } from "../src/data.js";
import { jsonValue } from "../src/data-core.js";
import { Query } from "../src/query.js";
import { dataFixture, odata, ref } from "./data-fixture.js";

describe("exact DATA JSON and selection bounds", () => {
  it("accepts 100 selected/write fields and rejects 101 without dispatch", async () => {
    const host = dataFixture();
    const selected = Array.from({ length: 100 }, (_, i) => `f${i}`);
    const payload = Object.fromEntries(selected.map((key) => [key, "x"]));
    // Online service metadata/automatic ID fields must not consume the 100 selected-column budget.
    host.retrieveRecord.mockResolvedValue({ ...payload, "@odata.etag": 'W/"1"', accountid: ref.id });
    await expect(Data.retrieve(ref, selected, host.client)).resolves.toMatchObject(payload);
    await expect(Data.create("account", payload, { allowedFields: selected, context: host.context })).resolves.toEqual(ref);
    await expect(Data.retrieve(ref, [...selected, "overflow"], host.client)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(Data.create("account", { ...payload, overflow: "x" },
      { allowedFields: selected, context: host.context })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect(host.createRecord).toHaveBeenCalledTimes(1);
    expect(host.retrieveRecord).toHaveBeenCalledTimes(1);
  });
  it("accepts 65536 string characters, rejects 65537, and checks UTF-8 bytes separately", () => {
    expect(jsonValue("é".repeat(65_536))).toHaveLength(65_536);
    expect(() => jsonValue("x".repeat(65_537))).toThrow();
    const fields = { a: "x".repeat(65_536), b: "x".repeat(65_536), c: "x".repeat(65_536), d: "" };
    const overhead = JSON.stringify(fields).length - fields.a.length - fields.b.length - fields.c.length;
    fields.d = "x".repeat(262_144 - overhead - fields.a.length - fields.b.length - fields.c.length);
    expect(new TextEncoder().encode(JSON.stringify(fields)).byteLength).toBe(262_144);
    expect(() => jsonValue(fields)).not.toThrow();
    expect(() => jsonValue({ ...fields, d: fields.d + "x" })).toThrow();
    expect(() => jsonValue({ ...fields, a: fields.a.replace("x", "é") })).toThrow();
  });
  it("accepts 512 response object keys and rejects 513", () => {
    const value = Object.fromEntries(Array.from({ length: 512 }, (_, i) => [`f${i}`, i]));
    expect(() => jsonValue(value)).not.toThrow();
    expect(() => jsonValue({ ...value, overflow: 0 })).toThrow();
  });
  it("bounds arrays at 1000, depth at 8 and total JSON nodes at 10000", () => {
    expect(() => jsonValue(Array.from({ length: 1000 }, () => 1))).not.toThrow();
    expect(() => jsonValue(Array.from({ length: 1001 }, () => 1))).toThrow();
    let value: unknown = 1;
    for (let depth = 0; depth < 8; depth++) { value = [value]; }
    expect(() => jsonValue(value)).not.toThrow();
    expect(() => jsonValue([value])).toThrow();
    const exact = Object.fromEntries(Array.from({ length: 10 }, (_, i) =>
      [`f${i}`, Array.from({ length: i === 9 ? 998 : 999 }, () => 0)]));
    expect(() => jsonValue(exact)).not.toThrow();
    expect(() => jsonValue({ ...exact, f9: Array.from({ length: 999 }, () => 0) })).toThrow();
    expect(() => jsonValue(new Array(2))).toThrow();
    expect(() => jsonValue({ value: BigInt(1) })).toThrow();
  });
  it("bounds raw filter text at 65536, order columns at 100, and expansion count at 10/top at 100", async () => {
    const host = dataFixture();
    const orders = Array.from({ length: 100 }, (_, i) => ({ column: `f${i}`, direction: "asc" as const }));
    const expand = Array.from({ length: 10 }, (_, i) => ({ navigationProperty: `nav${i}`, select: ["name"], top: 100 }));
    await expect(Query.executeOData("account", { ...odata, filter: "x".repeat(65_536), orderBy: orders, expand }, host.client))
      .resolves.toMatchObject({ complete: true });
    for (const changes of [{ filter: "x".repeat(65_537) }, { orderBy: [...orders, { column: "next", direction: "asc" }] },
      { expand: [...expand, { navigationProperty: "next", select: ["name"], top: 1 }] },
      { expand: [{ navigationProperty: "next", select: ["name"], top: 101 }] }]) {
      await expect(Query.executeOData("account", { ...odata, ...changes } as never, host.client))
        .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    }
    expect(host.retrieveMultipleRecords).toHaveBeenCalledTimes(1);
  });
  it("rejects oversized service rows, response arrays, and exists results instead of partial success", async () => {
    const host = dataFixture();
    host.retrieveRecord.mockResolvedValue({ name: "x".repeat(65_537) });
    await expect(Data.retrieve(ref, ["name"], host.client)).rejects.toMatchObject({ code: "DATA_RESPONSE_INVALID" });
    host.retrieveMultipleRecords.mockResolvedValue({ entities: [{ name: "A" }, { name: "B" }] });
    await expect(Data.exists("account", { entitySet: "accounts", select: ["name"], filter: "statecode eq 0" }, host.client))
      .rejects.toMatchObject({ code: "DATA_RESPONSE_INVALID" });
  });
});
