import { describe, expect, it, vi } from "vitest";
import { Batch } from "../src/batch.js";
import type { ReadBatchRequest } from "../src/batch.js";
import { Environment } from "../src/environment.js";
import { VbdError } from "../src/errors.js";
import { deferred, launchFixture } from "./environment-helpers.js";

const anyJson = (value: unknown): value is unknown => { void value; return true; };
function job(id: string, value: unknown): ReadBatchRequest<unknown> {
  return { id, kind: "read", run: () => value, validate: anyJson };
}
describe("bounded explicit read-job batches", () => {
  it.each([false, 0, "", null])("preserves valid JSON %s and exact result/count shapes", async value => {
    const fixture = launchFixture(), result = await Batch.execute([job("one", value)], { context: fixture.context });
    expect(result).toEqual({
      status: "succeeded", stopReason: "none", items: [{ id: "one", status: "succeeded", value }],
      counts: { total: 1, attempted: 1, succeeded: 1, failed: 0, skipped: 0 },
      resultBytes: new TextEncoder().encode(JSON.stringify(value)).byteLength
    });
    expect(fixture.retrieve).not.toHaveBeenCalled();
  });
  it("isolates loader and returned copies and rejects predicate transformations", async () => {
    const fixture = launchFixture(), original = { nested: { value: 0 } };
    const result = await Batch.execute([job("one", original)], { context: fixture.context });
    original.nested.value = 9;
    expect(result.items[0]).toEqual({ id: "one", status: "succeeded", value: { nested: { value: 0 } } });
    const changed = await Batch.execute([{
      ...job("changed", original),
      validate: (input: unknown): input is unknown => {
        if (typeof input === "object" && input !== null && "nested" in input &&
            typeof input.nested === "object" && input.nested !== null && "value" in input.nested) {
          input.nested.value = 123;
        }
        return true;
      }
    }], { context: fixture.context });
    expect(changed.status).toBe("failed");
    expect(original.nested.value).toBe(9);
    expect(changed.items[0]).toMatchObject({ status: "failed", error: { code: "CONFIG_VALUE_INVALID" } });
  });
  it("bounds dispatch concurrency and preserves input order despite reverse completion", async () => {
    const fixture = launchFixture(), gates = Array.from({ length: 3 }, deferred), started: number[] = [];
    let active = 0, maximum = 0;
    const requests = gates.map((gate, index): ReadBatchRequest<number> => ({
      id: `job${index}`, kind: "read",
      run: async () => {
        started.push(index); maximum = Math.max(maximum, ++active);
        await gate.promise; active--; return index;
      },
      validate: (value: unknown): value is number => typeof value === "number"
    }));
    const pending = Batch.execute(requests, { context: fixture.context, concurrency: 2 });
    expect(started).toEqual([0, 1]);
    gates[1]?.release();
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2]));
    gates[2]?.release(); gates[0]?.release();
    const report = await pending;
    expect(maximum).toBe(2);
    expect(report.items).toEqual([0, 1, 2].map(value => ({ id: `job${value}`, status: "succeeded", value })));
  });
  it("stops by default and explicitly records all unattempted jobs", async () => {
    const fixture = launchFixture(), never = vi.fn(), failed = new Error("PRIVATE_CANARY");
    const report = await Batch.execute([
      job("first", false), { ...job("failed", null), run: () => { throw failed; } },
      { ...job("skipped", null), run: never }
    ], { context: fixture.context, concurrency: 1 });
    expect(report).toMatchObject({
      status: "partial", stopReason: "failure",
      counts: { total: 3, attempted: 2, succeeded: 1, failed: 1, skipped: 1 }
    });
    expect(report.items[2]).toEqual({ id: "skipped", status: "skipped", reason: "failure" });
    expect(never).not.toHaveBeenCalled();
    expect(JSON.stringify(report)).not.toContain("PRIVATE_CANARY");
    const item = report.items[1];
    if (item?.status !== "failed") throw new Error("Missing failed item.");
    expect(item.diagnostic?.cause).toBe(failed);
    expect(Object.keys(item)).not.toContain("diagnostic");
  });
  it("continues only when explicitly selected and does not report mixed results as success", async () => {
    const fixture = launchFixture(), run = vi.fn(() => 2);
    const report = await Batch.execute([
      { ...job("failed", null), run: () => { throw new VbdError("ACCESS_DENIED", { operation: "test.read" }); } },
      { ...job("next", null), run }
    ], { context: fixture.context, concurrency: 1, failurePolicy: "continue" });
    expect(report).toMatchObject({
      status: "partial", stopReason: "none",
      counts: { total: 2, attempted: 2, succeeded: 1, failed: 1, skipped: 0 }
    });
    expect(report.items[0]).toMatchObject({ status: "failed", error: { code: "ACCESS_DENIED" } });
    expect(run).toHaveBeenCalledOnce();
  });
  it("drains already-started work after a stop rather than implying rollback", async () => {
    const fixture = launchFixture(), gate = deferred(), never = vi.fn();
    let returned = false;
    const pending = Batch.execute([
      { ...job("failed", null), run: async () => { await Promise.resolve(); throw new Error("failed"); } },
      { ...job("running", null), run: async () => { await gate.promise; return "finished"; } },
      { ...job("notStarted", null), run: never }
    ], { context: fixture.context, concurrency: 2 }).then(value => { returned = true; return value; });
    await Promise.resolve();
    expect(returned).toBe(false); expect(never).not.toHaveBeenCalled();
    gate.release();
    const report = await pending;
    expect(report.items[1]).toMatchObject({ status: "succeeded", value: "finished" });
    expect(report.items[2]).toEqual({ id: "notStarted", status: "skipped", reason: "failure" });
    expect(report.status).toBe("partial");
  });
  it("returns cancelled/skipped for a pre-aborted batch without invoking callbacks", async () => {
    const fixture = launchFixture(), run = vi.fn(), controller = new AbortController();
    controller.abort();
    const report = await Batch.execute([{ ...job("one", null), run }, job("two", 0)], {
      context: fixture.context, signal: controller.signal
    });
    expect(report).toMatchObject({
      status: "cancelled", stopReason: "cancelled",
      counts: { total: 2, attempted: 0, succeeded: 0, failed: 0, skipped: 2 }
    });
    expect(run).not.toHaveBeenCalled();
    expect(report.items.every(item => item.status === "skipped" && item.reason === "cancelled")).toBe(true);
  });
  it("cancellation prevents new dispatch but retains started read outcomes", async () => {
    const fixture = launchFixture(), controller = new AbortController(), gate = deferred(), never = vi.fn();
    const pending = Batch.execute([
      { ...job("first", null), run: async () => { await gate.promise; return false; } },
      { ...job("second", null), run: never }
    ], { context: fixture.context, concurrency: 1, signal: controller.signal });
    controller.abort(); gate.release();
    const report = await pending;
    expect(report).toMatchObject({
      status: "cancelled", stopReason: "cancelled",
      counts: { total: 2, attempted: 1, succeeded: 1, failed: 0, skipped: 1 }
    });
    expect(never).not.toHaveBeenCalled();
  });
  it("preserves the first stop reason when an in-flight output also exceeds the result budget", async () => {
    const fixture = launchFixture(), controller = new AbortController(), first = deferred(), second = deferred();
    let firstValidated = false;
    const pending = Batch.execute([
      {
        ...job("cancel", null), run: async () => { await first.promise; controller.abort(); return 0; },
        validate: (value: unknown): value is unknown => { void value; firstValidated = true; return true; }
      },
      { ...job("large", null), run: async () => { await second.promise; return "123456"; } }
    ], { context: fixture.context, concurrency: 2, signal: controller.signal, maxResultBytes: 1 });
    first.release();
    await vi.waitFor(() => expect(firstValidated).toBe(true));
    second.release();
    const report = await pending;
    expect(report.status).toBe("cancelled");
    expect(report.stopReason).toBe("cancelled");
    expect(report.counts).toEqual({ total: 2, attempted: 2, succeeded: 1, failed: 1, skipped: 0 });
  });
  it("measures exact aggregate UTF-8 bytes and reports output limits explicitly", async () => {
    const fixture = launchFixture(), never = vi.fn();
    const exact = await Batch.execute([job("one", "é")], { context: fixture.context, maxResultBytes: 4 });
    expect(exact.status).toBe("succeeded"); expect(exact.resultBytes).toBe(4);
    const report = await Batch.execute([job("one", "é"), job("two", 0), { ...job("three", null), run: never }], {
      context: fixture.context, concurrency: 1, maxResultBytes: 4, failurePolicy: "continue"
    });
    expect(report).toMatchObject({
      status: "limited", stopReason: "resultLimit", resultBytes: 4,
      counts: { total: 3, attempted: 2, succeeded: 1, failed: 1, skipped: 1 }
    });
    expect(report.items[1]).toMatchObject({ status: "failed", error: { code: "LIMIT_EXCEEDED" } });
    expect(never).not.toHaveBeenCalled();
  });
  it.each([undefined, new Date(), Infinity, () => undefined, JSON.parse('{"constructor":{}}') as unknown])(
    "rejects invalid/non-JSON output without claiming batch success", async value => {
      const report = await Batch.execute([job("one", value)], { context: launchFixture().context });
      expect(report.status).toBe("failed");
      expect(report.items[0]).toMatchObject({ status: "failed" });
    });
  it.each([
    () => false,
    async () => { throw new Error("PRIVATE_ASYNC_GUARD"); },
    () => { throw new Error("PRIVATE_THROWING_GUARD"); }
  ])("rejects/observes invalid guards without exposing their original text", async validate => {
    const fixture = launchFixture();
    const request = { ...job("one", 0), validate };
    const report = await Reflect.apply(Batch.execute, undefined, [[request], { context: fixture.context }]);
    expect(report.status).toBe("failed");
    expect(JSON.stringify(report)).not.toContain("PRIVATE_");
    await Promise.resolve(); await Promise.resolve();
  });
  it.each(["scope", "generation", "guard", "rejection"] as const)(
    "rejects a stale batch after %s changes and retains failures privately", async change => {
      const fixture = launchFixture(), gate = deferred(), never = vi.fn(), original = new Error("PRIVATE_FAILED_READ");
      const pending = Batch.execute([{
        ...job("one", null),
        run: async () => { await gate.promise; if (change === "rejection") throw original; return 0; },
        validate: (value: unknown): value is unknown => {
          void value;
          if (change === "guard") Environment.invalidate(undefined, { context: fixture.context });
          return true;
        }
      }, { ...job("two", null), run: never }], { context: fixture.context, concurrency: 1 });
      if (change === "scope" || change === "rejection") fixture.scope.languageId = 1043;
      if (change === "generation") Environment.invalidate(undefined, { context: fixture.context });
      gate.release();
      await expect(pending).rejects.toMatchObject({ code: "CONFIG_EXPIRED", cause: { attempted: 1 } });
      if (change === "rejection") {
        await expect(pending).rejects.toMatchObject({
          cause: { operationFailures: [{ id: "one", diagnostic: { cause: original } }] }
        });
      }
      expect(never).not.toHaveBeenCalled();
    });
  it("reports cancellation observer failures explicitly and releases the active batch slot", async () => {
    const fixture = launchFixture(), run = vi.fn();
    let reads = 0;
    const signal = {
      get aborted(): boolean {
        if (++reads > 1) throw new Error("PRIVATE_OBSERVER_FAILURE");
        return false;
      }
    };
    const pending = Batch.execute([{ ...job("one", 0), run }], { context: fixture.context, signal });
    await expect(pending).rejects.toMatchObject({ code: "OPERATION_FAILED" });
    try { await pending; } catch (error) { expect(String(error)).not.toContain("PRIVATE_OBSERVER_FAILURE"); }
    expect(run).not.toHaveBeenCalled();
    await expect(Batch.execute([job("next", 0)], { context: fixture.context })).resolves.toMatchObject({ status: "succeeded" });
  });
  it("drains every started request before reporting a fatal scope change", async () => {
    const fixture = launchFixture(), first = deferred(), second = deferred();
    let settled = false;
    const pending = Batch.execute([
      { ...job("one", null), run: async () => { await first.promise; return 1; } },
      { ...job("two", null), run: async () => { await second.promise; return 2; } }
    ], { context: fixture.context, concurrency: 2 }).finally(() => { settled = true; });
    fixture.scope.userId = crypto.randomUUID(); first.release();
    await Promise.resolve(); await Promise.resolve();
    expect(settled).toBe(false);
    second.release();
    await expect(pending).rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
  });
  it("does not count a scope-rejected pre-dispatch reservation as an attempted callback", async () => {
    const fixture = launchFixture(), run = vi.fn();
    let checks = 0;
    const context = {
      ...fixture.context,
      getScope: () => {
        if (++checks === 3) fixture.scope.languageId = 1043;
        return { ...fixture.scope };
      }
    };
    await expect(Batch.execute([{ ...job("one", 0), run }], { context }))
      .rejects.toMatchObject({ code: "CONFIG_EXPIRED", cause: { attempted: 0, operationFailures: [] } });
    expect(run).not.toHaveBeenCalled();
  });
  it.each([
    { requests: [] }, { requests: [job("same", 1), job("SAME", 2)] },
    { requests: [{ ...job("one", 0), kind: "write" }] }, { requests: [{ ...job("one", 0), id: "" }] }
  ])(
    "rejects invalid requests before dispatch", async ({ requests }) => {
      await expect(Reflect.apply(Batch.execute, undefined, [requests, { context: launchFixture().context }]))
        .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    });
  it("rejects getters/cycles without executing request accessors", async () => {
    const read = vi.fn();
    const accessor = Object.defineProperty(job("one", 0), "run", { enumerable: true, get: read });
    await expect(Batch.execute([accessor], { context: launchFixture().context })).rejects.toBeInstanceOf(VbdError);
    expect(read).not.toHaveBeenCalled();
    const cyclic: Record<string, unknown> = { ...job("cycle", 0), run: read };
    cyclic.self = cyclic;
    await expect(Reflect.apply(Batch.execute, undefined, [[cyclic], {
      context: launchFixture().context
    }])).rejects.toBeInstanceOf(VbdError);
    expect(read).not.toHaveBeenCalled();
  });
  it("uses the maximum eight-way concurrency without exceeding it", async () => {
    let active = 0, maximum = 0;
    const requests = Array.from({ length: 17 }, (_, index) => ({
      ...job(`entry${index}`, 0),
      run: async () => {
        maximum = Math.max(maximum, ++active);
        await Promise.resolve();
        active--;
        return index;
      }
    }));
    const report = await Batch.execute(requests, { context: launchFixture().context, concurrency: 8 });
    expect(maximum).toBe(8);
    expect(report.counts.succeeded).toBe(17);
  });
  it.each([
    { concurrency: 0 }, { concurrency: 9 }, { concurrency: 1.5 },
    { maxResultBytes: 0 }, { maxResultBytes: 2_097_153 }, { failurePolicy: "ignore" },
    { approvedWrites: true }, { signal: { aborted: "false" } }
  ])("rejects unsupported policy before running callbacks", async options => {
    const run = vi.fn();
    await expect(Reflect.apply(Batch.execute, undefined, [[{ ...job("one", 0), run }], {
      context: launchFixture().context, ...options
    }])).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(run).not.toHaveBeenCalled();
  });
  it("accepts exactly 1000 unique reads and rejects the 1001st", async () => {
    const requests = Array.from({ length: 1000 }, (_, index) => job(`entry${index}`, false));
    const result = await Batch.execute(requests, { context: launchFixture().context, concurrency: 8 });
    expect(result.status).toBe("succeeded");
    expect(result.counts).toEqual({ total: 1000, attempted: 1000, succeeded: 1000, failed: 0, skipped: 0 });
    await expect(Batch.execute([...requests, job("extra", false)], { context: launchFixture().context })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });
  it("holds at most eight active batches without evicting or detaching unresolved work", async () => {
    const gate = deferred(), fixture = launchFixture();
    const pending = Array.from({ length: 8 }, (_, index) => Batch.execute([{
      ...job(`entry${index}`, null), run: () => gate.promise
    }], { context: fixture.context }));
    try {
      await expect(Batch.execute([job("extra", 0)], { context: fixture.context })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    } finally { gate.release(); await Promise.all(pending); }
    await expect(Batch.execute([job("released", 0)], { context: fixture.context })).resolves.toMatchObject({ status: "succeeded" });
  });
});
