import { afterEach, describe, expect, it, vi } from "vitest";
import { Diagnostics, Environment } from "../src/index.js";
import { isRecord } from "../src/validation.js";
import { deferred, readFixture } from "./environment-helpers.js";
import { first } from "./helpers.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("typed environment values", () => {
  it("uses explicit current over default and records observable provenance", async () => {
    const host = readFixture({ vbd_Text: { type: 100000000, current: "current", defaultValue: "default" } });
    const result = await Environment.getText("vbd_Text", { context: host.context });
    expect(result).toMatchObject({ value: "current", source: "current", type: "text", cached: false });
    expect(host.retrieve).toHaveBeenCalledTimes(2);
    expect(host.retrieve.mock.calls.every((call) => !call[1].includes("defaultvalue"))).toBe(true);
  });

  it.each([undefined, null])("uses default only when current is absent: %s", async (current) => {
    const host = readFixture({
      vbd_Text: { type: 100000000, ...(current === undefined ? {} : { current }), defaultValue: "default" }
    });
    expect(await Environment.getText("vbd_Text", { context: host.context }))
      .toMatchObject({ value: "default", source: "default" });
    expect(host.retrieve).toHaveBeenCalledTimes(3);
  });

  it("preserves empty current values instead of revealing a default", async () => {
    const host = readFixture({ vbd_Text: { type: 100000000, current: "", defaultValue: "default" } });
    await expect(Environment.getText("vbd_Text", { context: host.context }))
      .rejects.toMatchObject({ code: "CONFIG_VALUE_INVALID" });
    expect(await Environment.getText("vbd_Text", { context: host.context, allowEmpty: true }))
      .toMatchObject({ value: "", source: "current" });
    expect(host.retrieve.mock.calls.every((call) => !call[1].includes("defaultvalue"))).toBe(true);
  });

  it("makes whitespace trimming explicit", async () => {
    const host = readFixture({ vbd_Text: { type: 100000000, current: "  content  " } });
    expect((await Environment.getText("vbd_Text", { context: host.context })).value).toBe("  content  ");
    expect((await Environment.getText("vbd_Text", { context: host.context, trim: true })).value).toBe("content");
  });

  it.each([["0", 0], ["-12.5", -12.5], ["1e2", 100], [" .5 ", 0.5]] as const)(
    "parses invariant numeric %s as %s", async (current, value) => {
      const host = readFixture({ vbd_Number: { type: 100000001, current } });
      expect((await Environment.getNumber("vbd_Number", { context: host.context })).value).toBe(value);
    }
  );

  it.each(["", " ", "Infinity", "NaN", "0x10", "1,5", "1e309", "1.2.3"])(
    "rejects invalid numeric content without coercion: %s", async (current) => {
      const host = readFixture({ vbd_Number: { type: 100000001, current } });
      await expect(Environment.getNumber("vbd_Number", { context: host.context }))
        .rejects.toMatchObject({ code: "CONFIG_VALUE_INVALID" });
    }
  );

  it("validates numeric ranges and rejects inverted bounds before reading", async () => {
    const host = readFixture({ vbd_Number: { type: 100000001, current: "5" } });
    await expect(Environment.getNumber("vbd_Number", { context: host.context, min: 6 }))
      .rejects.toMatchObject({ code: "CONFIG_VALUE_INVALID" });
    await expect(Environment.getNumber("vbd_Number", { context: host.context, max: 4 }))
      .rejects.toMatchObject({ code: "CONFIG_VALUE_INVALID" });
    expect((await Environment.getNumber("vbd_Number", { context: host.context, min: 5, max: 5 })).value).toBe(5);
    host.retrieve.mockClear();
    await expect(Environment.getNumber("vbd_Number", { context: host.context, min: 6, max: 4 }))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(host.retrieve).not.toHaveBeenCalled();
  });

  it.each([["true", true], [" YES ", true], ["false", false], ["No", false]] as const)(
    "parses explicit Boolean %s as %s", async (current, value) => {
      const host = readFixture({ vbd_Flag: { type: 100000002, current } });
      expect((await Environment.getBoolean("vbd_Flag", { context: host.context })).value).toBe(value);
    }
  );

  it.each(["0", "1", "enabled", "", "off"])("rejects ambiguous Boolean %s", async (current) => {
    const host = readFixture({ vbd_Flag: { type: 100000002, current } });
    await expect(Environment.getBoolean("vbd_Flag", { context: host.context }))
      .rejects.toMatchObject({ code: "CONFIG_VALUE_INVALID" });
  });

  it("validates JSON with exactly one runtime guard invocation", async () => {
    const host = readFixture({ vbd_Json: { type: 100000003, current: '{"enabled":false}' } });
    let invocations = 0;
    const result = await Environment.getJson("vbd_Json", {
      context: host.context,
      validate: (value: unknown): value is { enabled: boolean } => {
        invocations++;
        return isRecord(value) && typeof value.enabled === "boolean";
      }
    });
    expect(result.value.enabled).toBe(false);
    expect(invocations).toBe(1);
    result.value.enabled = true;
    const reread = await Environment.getJson("vbd_Json", {
      context: host.context,
      validate: (value: unknown): value is { enabled: boolean } =>
        isRecord(value) && typeof value.enabled === "boolean"
    });
    expect(reread.value.enabled).toBe(false);
  });

  it("rejects invalid JSON, failed/throwing guards, and non-Boolean guard results", async () => {
    const host = readFixture({ vbd_Json: { type: 100000003, current: "INVALID_JSON_CANARY" } });
    const validate = (value: unknown): value is unknown => { void value; return false; };
    await expect(Environment.getJson("vbd_Json", { context: host.context, validate }))
      .rejects.toMatchObject({ code: "CONFIG_VALUE_INVALID" });
    host.variable("vbd_Json").current = "{}";
    await expect(Environment.getJson("vbd_Json", { context: host.context, validate }))
      .rejects.toMatchObject({ code: "CONFIG_VALUE_INVALID" });
    await expect(Environment.getJson("vbd_Json", {
      context: host.context, validate: (value: unknown): value is unknown => {
        void value;
        throw new Error("GUARD_CANARY");
      }
    })).rejects.toMatchObject({ code: "CONFIG_VALUE_INVALID" });
    await expect(Reflect.apply(Environment.getJson, undefined, ["vbd_Json", {
      context: host.context, validate: () => "yes"
    }])).rejects.toMatchObject({ code: "CONFIG_VALUE_INVALID" });
  });

  it("supports all general get types through the same contracts", async () => {
    const host = readFixture({
      vbd_Text: { type: 100000000, current: "value" },
      vbd_Number: { type: 100000001, current: "0" },
      vbd_Flag: { type: 100000002, current: "false" },
      vbd_Json: { type: 100000003, current: "[]" }
    });
    expect((await Environment.get("vbd_Text", { type: "text", context: host.context })).value).toBe("value");
    expect((await Environment.get("vbd_Number", { type: "number", context: host.context })).value).toBe(0);
    expect((await Environment.get("vbd_Flag", { type: "boolean", context: host.context })).value).toBe(false);
    expect((await Environment.get("vbd_Json", {
      type: "json", context: host.context, validate: Array.isArray
    })).value).toEqual([]);
  });

  it.each(["resolved", "rejected", "pending"])(
    "rejects a malformed async JSON guard without unhandled rejections or waiting: %s", async (mode) => {
      const host = readFixture({ vbd_Json: { type: 100000003, current: "{}" } });
      const validate = () => mode === "resolved" ? Promise.resolve(true)
        : mode === "rejected" ? Promise.reject(new Error("ASYNC_GUARD_CANARY"))
          : new Promise<boolean>(() => {});
      await expect(Reflect.apply(Environment.getJson, undefined, ["vbd_Json", {
        context: host.context, validate
      }])).rejects.toMatchObject({ code: "CONFIG_VALUE_INVALID" });
      await expect(Reflect.apply(Environment.get, undefined, ["vbd_Json", {
        type: "json", context: host.context, validate
      }])).rejects.toMatchObject({ code: "CONFIG_VALUE_INVALID" });
    }
  );
});

describe("metadata-first safety and missing policies", () => {
  it.each([100000004, 100000005])("does not fetch values/defaults for protected type %s", async (type) => {
    const host = readFixture({ vbd_Protected: { type, current: "PROTECTED_CANARY" } });
    await expect(Environment.getText("vbd_Protected", { context: host.context })).rejects.toMatchObject({
      code: type === 100000005 ? "SECRET_NOT_SUPPORTED" : "UNSUPPORTED_VARIABLE_TYPE"
    });
    expect(host.retrieve).toHaveBeenCalledTimes(1);
    expect(host.retrieve.mock.calls[0]?.[1]).not.toMatch(/defaultvalue|\$select=value/);
    const metadata = await Environment.getDefinition("vbd_Protected", { context: host.context });
    expect(Object.keys(metadata).sort()).toEqual(["id", "schemaName", "type"]);
    expect(JSON.stringify(metadata)).not.toContain("PROTECTED_CANARY");
  });

  it("rejects a future unknown definition type and mismatched requested type", async () => {
    const host = readFixture({
      vbd_Future: { type: 100000006, current: "unused" },
      vbd_Flag: { type: 100000002, current: "false" }
    });
    await expect(Environment.getDefinition("vbd_Future", { context: host.context }))
      .rejects.toMatchObject({ code: "UNSUPPORTED_VARIABLE_TYPE" });
    await expect(Environment.getText("vbd_Flag", { context: host.context }))
      .rejects.toMatchObject({ code: "CONFIG_TYPE_MISMATCH" });
  });

  it("absorbs only the explicitly selected absence cases", async () => {
    const host = readFixture({ vbd_Unset: { type: 100000000 } });
    expect(await Environment.getOptional("vbd_Missing", {
      type: "text", context: host.context, absence: "definition"
    })).toBeUndefined();
    expect(await Environment.getOptional("vbd_Unset", {
      type: "text", context: host.context, absence: "value"
    })).toBeUndefined();
    await expect(Environment.getOptional("vbd_Missing", {
      type: "text", context: host.context, absence: "value"
    })).rejects.toMatchObject({ code: "CONFIG_NOT_FOUND" });
    await expect(Environment.getOptional("vbd_Unset", {
      type: "text", context: host.context, absence: "definition"
    })).rejects.toMatchObject({ code: "CONFIG_VALUE_MISSING" });
  });

  it.each([403, 401])("never treats denied status %s as optional absence", async (status) => {
    const host = readFixture({});
    host.retrieve.mockRejectedValueOnce({ status, message: "TOKEN_CANARY" });
    await expect(Environment.getOptional("vbd_Private", {
      type: "text", context: host.context, absence: "either"
    })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });

  it("retains transport causes but diagnostic reporting never echoes them", async () => {
    const host = readFixture({});
    const cause = new Error("TRANSPORT_SECRET_CANARY");
    host.retrieve.mockRejectedValueOnce(cause);
    const error = await Environment.getText("vbd_Private", { context: host.context }).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: "DATA_READ_FAILED", cause });
    const sink = vi.fn();
    await Diagnostics.report(error, { operation: "test", sink });
    expect(JSON.stringify(sink.mock.calls)).not.toContain("TRANSPORT_SECRET_CANARY");
  });

  it("rejects ambiguous rows and partial pages instead of choosing a candidate", async () => {
    for (const response of [{ entities: [{}, {}] }, { entities: [{}], nextLink: "NEXT_PAGE_CANARY" }]) {
      const host = readFixture({});
      host.retrieve.mockResolvedValueOnce(response);
      await expect(Environment.getOptional("vbd_Name", {
        type: "text", context: host.context, absence: "either"
      })).rejects.toMatchObject({ code: "CONFIG_AMBIGUOUS" });
    }
  });

  it("rejects ambiguous current values, malformed responses, and definition changes", async () => {
    const host = readFixture({ vbd_Text: { type: 100000000, current: "current" } });
    const original = host.retrieve.getMockImplementation();
    if (!original) { throw new Error("Fixture requires an implementation."); }
    host.retrieve.mockImplementation(async (...args) => args[0] === "environmentvariablevalue"
      ? { entities: [{ value: "one" }, { value: "two" }] } : original(...args));
    await expect(Environment.getText("vbd_Text", { context: host.context }))
      .rejects.toMatchObject({ code: "CONFIG_AMBIGUOUS" });
    host.retrieve.mockResolvedValueOnce({ records: [] });
    await expect(Environment.getText("vbd_Text", { context: host.context }))
      .rejects.toMatchObject({ code: "DATA_RESPONSE_INVALID" });
    host.variable("vbd_Text").current = null;
    host.retrieve.mockImplementation(async (...args) => args[1].includes("$select=defaultvalue,type")
      ? { entities: [{ type: 100000005, defaultvalue: null }] } : original(...args));
    await expect(Environment.getText("vbd_Text", { context: host.context }))
      .rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
  });

  it("rejects invalid schema names and options before querying", async () => {
    const host = readFixture({});
    await expect(Environment.getText("x' or 1 eq 1", { context: host.context }))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(Reflect.apply(Environment.getText, undefined, ["vbd_Name", {
      context: host.context, unexpected: "CANARY"
    }])).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(host.retrieve).not.toHaveBeenCalled();
  });
});

describe("bounded scoped cache and batches", () => {
  it("deduplicates in-flight reads and isolates cached values by user/language", async () => {
    const host = readFixture({ vbd_Text: { type: 100000000, current: "first" } });
    const values = await Promise.all(Array.from({ length: 10 }, () =>
      Environment.getText("vbd_Text", { context: host.context })));
    expect(values.every((value) => value.value === "first")).toBe(true);
    expect(host.retrieve).toHaveBeenCalledTimes(2);
    expect((await Environment.getText("vbd_Text", { context: host.context })).cached).toBe(true);
    host.scope.userId = crypto.randomUUID();
    host.variable("vbd_Text").current = "second";
    expect((await Environment.getText("vbd_Text", { context: host.context })).value).toBe("second");
    host.scope.languageId = 1043;
    host.variable("vbd_Text").current = "third";
    expect((await Environment.getText("vbd_Text", { context: host.context })).value).toBe("third");
    host.scope.environmentUrl = "https://other.example";
    host.variable("vbd_Text").current = "fourth";
    expect((await Environment.getText("vbd_Text", { context: host.context })).value).toBe("fourth");
  });

  it("expires exactly at TTL and supports explicit cache bypass", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T10:00:00Z"));
    const host = readFixture({ vbd_Text: { type: 100000000, current: "first" } });
    await Environment.getText("vbd_Text", { context: host.context });
    host.variable("vbd_Text").current = "second";
    vi.setSystemTime(Date.now() + 59_999);
    expect((await Environment.getText("vbd_Text", { context: host.context })).value).toBe("first");
    vi.setSystemTime(Date.now() + 1);
    expect((await Environment.getText("vbd_Text", { context: host.context })).value).toBe("second");
    host.variable("vbd_Text").current = "third";
    expect((await Environment.getText("vbd_Text", { context: host.context, cacheTtlMs: 0 })).value).toBe("third");
  });

  it("rechecks scope after a cached read yields", async () => {
    const host = readFixture({ vbd_Text: { type: 100000000, current: "private" } });
    await Environment.getText("vbd_Text", { context: host.context });
    const pending = Environment.getText("vbd_Text", { context: host.context });
    const expected = expect(pending).rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
    host.scope.userId = crypto.randomUUID();
    await expected;
  });

  it("rejects invalidation from a runtime validation callback", async () => {
    const host = readFixture({ vbd_Json: { type: 100000003, current: "{}" } });
    await expect(Environment.getJson("vbd_Json", {
      context: host.context,
      validate: (value: unknown): value is Record<string, unknown> => {
        Environment.invalidate(undefined, { context: host.context });
        return isRecord(value);
      }
    })).rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
  });

  it.each([-1, 300001, 1.5])("rejects TTL outside the integer 0..300000 bound: %s", async (cacheTtlMs) => {
    const host = readFixture({});
    await expect(Environment.getText("vbd_Name", { context: host.context, cacheTtlMs }))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(host.retrieve).not.toHaveBeenCalled();
  });

  it("does not retain failures or caller-mutable parsed JSON in cache", async () => {
    const host = readFixture({ vbd_Flag: { type: 100000002, current: "invalid" } });
    await expect(Environment.getBoolean("vbd_Flag", { context: host.context })).rejects.toBeDefined();
    host.variable("vbd_Flag").current = "false";
    expect((await Environment.getBoolean("vbd_Flag", { context: host.context })).value).toBe(false);
    expect(host.retrieve).toHaveBeenCalledTimes(4);
  });

  it("invalidates only selected cached names within the selected scope", async () => {
    const host = readFixture({
      vbd_First: { type: 100000000, current: "first" },
      vbd_Second: { type: 100000000, current: "second" }
    });
    await Environment.preload([
      { schemaName: "vbd_First", type: "text" }, { schemaName: "vbd_Second", type: "text" }
    ], { context: host.context });
    expect(Environment.invalidate("VBD_FIRST", { context: host.context })).toBe(1);
    expect((await Environment.getText("vbd_Second", { context: host.context })).cached).toBe(true);
    expect((await Environment.getText("vbd_First", { context: host.context })).cached).toBe(false);
  });

  it("rejects scope changes and invalidation during a read without caching stale results", async () => {
    for (const change of ["scope", "invalidate"]) {
      const host = readFixture({ vbd_Text: { type: 100000000, current: "value" } });
      const gate = deferred();
      const original = host.retrieve.getMockImplementation();
      if (!original) { throw new Error("Fixture requires an implementation."); }
      host.retrieve.mockImplementation(async (...args) => { await gate.promise; return original(...args); });
      const pending = Environment.getText("vbd_Text", { context: host.context });
      const expected = expect(pending).rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
      if (change === "scope") { host.scope.userId = crypto.randomUUID(); }
      else { Environment.invalidate(undefined, { context: host.context }); }
      gate.release();
      await expected;
      host.retrieve.mockImplementation(original);
      expect((await Environment.getText("vbd_Text", { context: host.context })).cached).toBe(false);
    }
  });

  it("bounds batches and concurrency and associates failed requests without returning partial success", async () => {
    const variables = Object.fromEntries(Array.from({ length: 100 }, (_, index) =>
      [`vbd_Item${index}`, { type: 100000000, current: `value${index}` }]));
    const host = readFixture(variables);
    const requests = Object.keys(variables).map((schemaName) => ({ schemaName, type: "text" as const }));
    const result = await Environment.getMany(requests, { context: host.context, concurrency: 8 });
    expect(Object.keys(result)).toHaveLength(100);
    expect(host.maximumActive()).toBeLessThanOrEqual(8);
    await expect(Environment.getMany([...requests, { schemaName: "vbd_Over", type: "text" }], {
      context: host.context
    })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(Environment.getMany([first(requests), first(requests)], {
      context: host.context
    })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(Environment.getMany([{ schemaName: "vbd_Missing", type: "text" }], {
      context: host.context
    })).rejects.toMatchObject({
      code: "ENVIRONMENT_BATCH_FAILED", cause: { schemaName: "vbd_Missing", error: { code: "CONFIG_NOT_FOUND" } }
    });
    expect(await Environment.preload(requests.slice(0, 2), { context: host.context })).toEqual({ resolved: 2 });
  });

  it.each([0, 9, 1.5])("rejects concurrency outside the integer 1..8 bound: %s", async (concurrency) => {
    const host = readFixture({});
    await expect(Environment.getMany([{ schemaName: "vbd_Text", type: "text" }], {
      context: host.context, concurrency
    })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(host.retrieve).not.toHaveBeenCalled();
  });

  it("uses four workers by default", async () => {
    const variables = Object.fromEntries(Array.from({ length: 8 }, (_, index) =>
      [`vbd_Worker${index}`, { type: 100000000, current: "value" }]));
    const host = readFixture(variables);
    await Environment.getMany(Object.keys(variables).map((schemaName) => ({
      schemaName, type: "text"
    })), { context: host.context });
    expect(host.maximumActive()).toBe(4);
  });

  it("rejects mid-batch identity changes without returning mixed values or querying later requests", async () => {
    const host = readFixture({
      vbd_First: { type: 100000003, current: "{}" },
      vbd_Second: { type: 100000000, current: "second" }
    });
    await expect(Environment.getMany([
      {
        schemaName: "vbd_First", type: "json",
        validate: () => {
          queueMicrotask(() => { host.scope.userId = crypto.randomUUID(); });
          return true;
        }
      },
      { schemaName: "vbd_Second", type: "text" }
    ], { context: host.context, concurrency: 1 })).rejects.toMatchObject({
      code: "ENVIRONMENT_BATCH_FAILED", cause: { error: { code: "CONFIG_EXPIRED" } }
    });
    expect(host.retrieve).toHaveBeenCalledTimes(2);
  });

  it("limits simultaneous loads even when pending entries are invalidated", async () => {
    const variables = Object.fromEntries(Array.from({ length: 65 }, (_, index) =>
      [`vbd_Load${index}`, { type: 100000000, current: "value" }]));
    const host = readFixture(variables);
    const original = host.retrieve.getMockImplementation();
    if (!original) { throw new Error("Fixture requires an implementation."); }
    const gate = deferred();
    host.retrieve.mockImplementation(async (...args) => { await gate.promise; return original(...args); });
    const pending = Array.from({ length: 64 }, (_, index) =>
      Environment.getText(`vbd_Load${index}`, { context: host.context }));
    const settled = Promise.allSettled(pending);
    Environment.invalidate(undefined, { context: host.context });
    await expect(Environment.getText("vbd_Load64", { context: host.context }))
      .rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    gate.release();
    expect((await settled).every((result) => result.status === "rejected")).toBe(true);
    expect((await Environment.getText("vbd_Load64", { context: host.context })).value).toBe("value");
  });

  it("enforces entry, cached-character and individual-value bounds", async () => {
    const variables = Object.fromEntries(Array.from({ length: 129 }, (_, index) =>
      [`vbd_Entry${index}`, { type: 100000000, current: "value" }]));
    const host = readFixture(variables);
    for (const name of Object.keys(variables)) { await Environment.getText(name, { context: host.context }); }
    expect((await Environment.getText("vbd_Entry0", { context: host.context })).cached).toBe(false);
    const large = readFixture({
      vbd_One: { type: 100000000, current: "x".repeat(1_048_576) },
      vbd_Two: { type: 100000000, current: "y".repeat(1_048_576) },
      vbd_Three: { type: 100000000, current: "z".repeat(1_048_576) },
      vbd_Over: { type: 100000000, current: "x".repeat(1_048_577) }
    });
    for (const name of ["vbd_One", "vbd_Two", "vbd_Three"]) {
      expect((await Environment.getText(name, { context: large.context })).value).toHaveLength(1_048_576);
    }
    expect((await Environment.getText("vbd_One", { context: large.context })).cached).toBe(false);
    await expect(Environment.getText("vbd_Over", { context: large.context }))
      .rejects.toMatchObject({ code: "DATA_RESPONSE_INVALID" });
  });
});

describe("supported online Xrm adapter", () => {
  it("uses the current platform context and bounded WebApi calls without tokens", async () => {
    const host = readFixture({ vbd_Text: { type: 100000000, current: "value" } });
    vi.stubGlobal("Xrm", {
      Utility: { getGlobalContext: () => ({
        getClientUrl: () => host.scope.environmentUrl,
        userSettings: { userId: host.scope.userId, languageId: host.scope.languageId },
        client: { getClientState: () => "Online" }
      }) },
      WebApi: { retrieveMultipleRecords: host.retrieve }
    });
    expect((await Environment.getText("vbd_Text")).value).toBe("value");
    expect(host.retrieve.mock.calls.every((call) => call[2] === 2)).toBe(true);
  });

  it("fails explicitly outside a supported online client", async () => {
    vi.stubGlobal("Xrm", undefined);
    await expect(Environment.getText("vbd_Text")).rejects.toMatchObject({ code: "UNSUPPORTED_SURFACE" });
    const host = readFixture({});
    host.scope.online = false;
    await expect(Environment.getText("vbd_Text", { context: host.context }))
      .rejects.toMatchObject({ code: "UNSUPPORTED_SURFACE" });
    expect(host.retrieve).not.toHaveBeenCalled();
  });
});
