import { describe, expect, it, vi } from "vitest";
import { Grids } from "../src/commands.js";
import type { GridOperation, GridRunOptions } from "../src/grid-interactions.js";
import { Context } from "../src/context.js";
import { VbdError } from "../src/errors.js";
import { appId, deferred, launchFixture } from "./environment-helpers.js";
import { nativeGrid } from "./native-fixture.js";

function fixture(count = 3) {
  const source = launchFixture();
  const refs = Array.from({ length: count }, () => ({ entityType: "account", id: crypto.randomUUID() }));
  const native = nativeGrid(refs);
  const options: GridRunOptions = { allowedTables: ["account"], context: source.context };
  const run = vi.fn<GridOperation<number>["run"]>(() => 0);
  const operation: GridOperation<number> = { kind: "read", run, validate: (value): value is number => typeof value === "number" };
  return { ...native, refs, source, options, run, operation };
}
describe("selected grid processing", () => {
  it("runs an immutable actual selection sequentially, even when the live selection changes", async () => {
    const f = fixture(), order: string[] = [];
    f.run.mockImplementation(record => {
      expect(Object.isFrozen(record)).toBe(true);
      order.push(record.id);
      f.state.references = [];
      return 0;
    });
    const result = await Grids.runSelected(f.grid, f.operation, f.options);
    expect(result.status).toBe("succeeded");
    expect(result.counts).toEqual({ requested: 3, attempted: 3, succeeded: 3, failed: 0, uncertain: 0, skipped: 0 });
    expect(order).toEqual(f.refs.map(ref => ref.id));
    expect(result.items.every(item => item.status === "succeeded" && item.value === 0)).toBe(true);
    expect(f.source.retrieve).not.toHaveBeenCalled();
  });
  it("uses explicitly supplied normalized references on a genuine grid context", async () => {
    const f = fixture();
    const input = Context.fromGridCommand(f.grid);
    const result = await Grids.runSelected(input, f.operation, {
      ...f.options, selectedReferences: [{ Id: `{${appId.toUpperCase()}}`, TypeName: "ACCOUNT" }]
    });
    expect(result.items[0]?.record).toEqual({ id: appId, entityType: "account" });
    expect(f.run).toHaveBeenCalledTimes(1);
  });
  it("requires an explicit table for ID-only references when native table identity is absent", async () => {
    const f = fixture();
    const result = await Grids.runSelected(f.grid, f.operation, {
      ...f.options, selectedReferences: [appId], entityType: "account"
    });
    expect(result.status).toBe("succeeded");
  });
  it.each([
    {}, { allowedTables: [] }, { allowedTables: ["account", "ACCOUNT"] },
    { allowedTables: ["account"], min: 0 }, { allowedTables: ["account"], max: 1001 },
    { allowedTables: ["account"], min: 4, max: 3 },
    { allowedTables: ["account"], concurrency: 2 }, { allowedTables: ["account"], retry: 1 },
    { allowedTables: ["account"], failurePolicy: "ignore" },
    { allowedTables: ["account"], maxResultBytes: 0 },
    { allowedTables: ["account"], unknown: true }, { allowedTables: ["bad/name"] },
    { allowedTables: ["account"], selectedReferences: [null] },
    { allowedTables: ["account"], selectedReferences: ["bad-guid"] },
    { allowedTables: ["account"], selectedReferences: [{ id: appId, Id: appId, entityType: "account" }] },
    { allowedTables: ["account"], selectedReferences: [{ id: appId, entityType: "contact" }] }
  ])("rejects invalid contracts before any operation: %j", async settings => {
    const f = fixture();
    await expect(Reflect.apply(Grids.runSelected, undefined, [f.grid, f.operation, { context: f.source.context, ...settings }])).rejects.toBeInstanceOf(VbdError);
    expect(f.run).not.toHaveBeenCalled();
  });
  it.each([0, 101, 1001])("rejects empty/over-bound native selection of %i", async count => {
    const f = fixture(count);
    await expect(Grids.runSelected(f.grid, f.operation, f.options)).rejects.toBeInstanceOf(VbdError);
    expect(f.run).not.toHaveBeenCalled();
  });
  it("rejects duplicates and mixed tables unless mixing is explicitly permitted", async () => {
    const f = fixture();
    f.state.references = [f.refs[0]!, f.refs[0]!];
    await expect(Grids.runSelected(f.grid, f.operation, f.options)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    const ref = f.refs[1];
    if (!ref) throw new Error("Fixture identity missing");
    f.state.references = [{ id: appId, entityType: "contact" }, ref];
    await expect(Grids.runSelected(f.grid, f.operation, { ...f.options, allowedTables: ["contact", "account"] })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect((await Grids.runSelected(f.grid, f.operation, { ...f.options, allowedTables: ["contact", "account"], allowMixedTables: true })).status).toBe("succeeded");
  });
  it("rejects getter inputs without executing getters", async () => {
    const f = fixture(), getter = vi.fn(() => ["account"]);
    const options = Object.defineProperty({ context: f.source.context }, "allowedTables", { enumerable: true, get: getter });
    await expect(Reflect.apply(Grids.runSelected, undefined, [f.grid, f.operation, options])).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(getter).not.toHaveBeenCalled();
    expect(f.run).not.toHaveBeenCalled();
  });
  it("rejects unsafe option keys, cyclic callbacks and forged contexts", async () => {
    const f = fixture();
    const unsafe: unknown = JSON.parse('{"allowedTables":["account"],"__proto__":{}}');
    await expect(Reflect.apply(Grids.runSelected, undefined, [f.grid, f.operation, unsafe])).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    const cyclic: Record<string, unknown> = { ...f.operation }; cyclic.extra = cyclic;
    await expect(Reflect.apply(Grids.runSelected, undefined, [f.grid, cyclic, f.options])).rejects.toBeInstanceOf(VbdError);
    await expect(Grids.runSelected({ grid: f.grid }, f.operation, f.options)).rejects.toMatchObject({ code: "UNSUPPORTED_SURFACE" });
    expect(f.run).not.toHaveBeenCalled();
  });
  it("preserves false values", async () => {
    const f = fixture(1);
    const result = await Grids.runSelected(f.grid, {
      kind: "read", run: () => false, validate: (value): value is false => value === false
    }, f.options);
    expect(result.items[0]).toMatchObject({ status: "succeeded", value: false });
  });
  it.each(["read", "mutation"] as const)("reports %s rejection without secrets, stops and releases the grid", async kind => {
    const f = fixture();
    f.run.mockImplementationOnce(() => { throw new Error("SECRET_FAILURE_CANARY"); });
    const result = await Grids.runSelected(f.grid, { ...f.operation, kind }, f.options);
    expect(result.items.map(item => item.status)).toEqual([kind === "read" ? "failed" : "uncertain", "skipped", "skipped"]);
    expect(result.counts.attempted).toBe(1);
    expect(JSON.stringify(result)).not.toContain("SECRET_FAILURE_CANARY");
    expect((await Grids.runSelected(f.grid, f.operation, f.options)).status).toBe("succeeded");
  });
  it("continues after an uncertain mutation only with an explicit policy", async () => {
    const f = fixture();
    f.run.mockRejectedValueOnce(new Error("transport"));
    const result = await Grids.runSelected(f.grid, { ...f.operation, kind: "mutation" }, { ...f.options, failurePolicy: "continue" });
    expect(result.status).toBe("partial");
    expect(result.counts).toMatchObject({ attempted: 3, succeeded: 2, uncertain: 1 });
  });
  it.each([undefined, new Date(), { value: undefined }])("does not accept unsupported callback output %j", async output => {
    const f = fixture();
    f.run.mockImplementation(() => output);
    const result = await Grids.runSelected(f.grid, f.operation, f.options);
    expect(result.items[0]?.status).toBe("failed");
    expect(result.counts.attempted).toBe(1);
  });
  it("rejects false/async/mutating output guards and preserves mutation uncertainty", async () => {
    const f = fixture(1);
    for (const validate of [() => false, async () => true, (value: unknown) => {
      if (typeof value === "object" && value !== null) Reflect.set(value, "n", 2);
      return true;
    }]) {
      const result = await Reflect.apply(Grids.runSelected, undefined, [f.grid, {
        kind: "mutation", run: () => ({ n: 1 }), validate
      }, f.options]);
      expect(result.items[0].status).toBe("uncertain");
    }
  });
  it("stops at the exact result-byte budget without claiming completion", async () => {
    const f = fixture();
    f.run.mockReturnValue(10);
    const result = await Grids.runSelected(f.grid, f.operation, { ...f.options, maxResultBytes: 3 });
    expect(result.stopReason).toBe("resultLimit");
    expect(result.resultBytes).toBe(2);
    expect(result.items.map(item => item.status)).toEqual(["succeeded", "failed", "skipped"]);
    expect(result.counts.attempted).toBe(2);
  });
  it("does not dispatch cancelled work and does not roll back confirmed in-flight work", async () => {
    const f = fixture(), controller = new AbortController();
    controller.abort();
    const first = await Grids.runSelected(f.grid, f.operation, { ...f.options, signal: controller.signal });
    expect(first.status).toBe("cancelled");
    expect(first.counts).toMatchObject({ attempted: 0, skipped: 3 });
    const active = new AbortController();
    f.run.mockImplementation(() => { active.abort(); return 0; });
    const second = await Grids.runSelected(f.grid, f.operation, { ...f.options, signal: active.signal });
    expect(second.items.map(item => item.status)).toEqual(["succeeded", "skipped", "skipped"]);
    expect(second.stopReason).toBe("cancelled");
  });
  it("retains uncertain in-flight mutation and skipped refs on scope change", async () => {
    const f = fixture(), wait = deferred();
    f.run.mockImplementation(async () => { await wait.promise; return 0; });
    const pending = Grids.runSelected(f.grid, { ...f.operation, kind: "mutation" }, f.options);
    f.source.scope.userId = crypto.randomUUID();
    wait.release();
    const result = await pending;
    expect(result.stopReason).toBe("scopeChanged");
    expect(result.items.map(item => item.status)).toEqual(["uncertain", "skipped", "skipped"]);
    expect(result.counts.attempted).toBe(1);
  });
  it("does not continue after a context error thrown during an output guard", async () => {
    const f = fixture(), original = f.source.context.getScope;
    const result = await Grids.runSelected(f.grid, {
      ...f.operation, validate: (value): value is number => {
        f.source.context.getScope = () => { throw new Error("scope probe"); }; return typeof value === "number";
      }
    }, { ...f.options, failurePolicy: "continue" });
    expect(result.stopReason).toBe("contextError");
    expect(result.counts.attempted).toBe(1);
    f.source.context.getScope = original;
    expect((await Grids.runSelected(f.grid, f.operation, f.options)).status).toBe("succeeded");
  });
  it("rejects concurrent invocation on one grid, permits another and releases after completion", async () => {
    const f = fixture(1), other = fixture(1), wait = deferred();
    f.run.mockImplementation(async () => { await wait.promise; return 0; });
    const pending = Grids.runSelected(f.grid, f.operation, f.options);
    await expect(Grids.runSelected(f.grid, f.operation, f.options)).rejects.toMatchObject({ code: "RESOURCE_BUSY" });
    expect((await Grids.runSelected(other.grid, other.operation, other.options)).status).toBe("succeeded");
    wait.release();
    expect((await pending).status).toBe("succeeded");
  });
  it("bounds active grids at eight and releases the shared capacity", async () => {
    const fixtures = Array.from({ length: 9 }, () => fixture(1)), wait = deferred();
    const active = fixtures.slice(0, 8).map(f => Grids.runSelected(f.grid, {
      ...f.operation, run: async () => { await wait.promise; return 0; }
    }, f.options));
    const last = fixtures[8];
    if (!last) throw new Error("Missing ninth grid");
    await expect(Grids.runSelected(last.grid, last.operation, last.options)).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    wait.release();
    expect((await Promise.all(active)).every(result => result.status === "succeeded")).toBe(true);
    expect((await Grids.runSelected(last.grid, last.operation, last.options)).status).toBe("succeeded");
  });
});

function loadFixture() {
  const native = nativeGrid(), foreign = vi.fn(), handlers = new Set<(input: unknown) => void>([foreign]);
  const grid = {
    ...native.grid, getGridType: vi.fn(() => 2),
    addOnLoad: vi.fn(function(this: unknown, handler: (input: unknown) => void) { expect(this).toBe(grid); handlers.add(handler); }),
    removeOnLoad: vi.fn(function(this: unknown, handler: (input: unknown) => void) { expect(this).toBe(grid); handlers.delete(handler); })
  };
  const event = { getEventSource: () => grid };
  const fire = () => { for (const handler of [...handlers]) handler(event); };
  return { grid, handlers, foreign, event, fire };
}
describe("original subgrid OnLoad registration", () => {
  it("deduplicates, invokes and disposes only its own wrapper, preserving native receivers/foreign handlers", () => {
    const f = loadFixture(), handler = vi.fn();
    const token = Grids.registerOnLoad(f.grid, handler);
    expect(Grids.registerOnLoad(f.grid, handler)).toBe(token);
    f.fire();
    expect(handler).toHaveBeenCalledWith(f.event);
    expect(f.foreign).toHaveBeenCalledTimes(1);
    expect(f.grid.addOnLoad).toHaveBeenCalledTimes(1);
    const wrapper = [...f.handlers].find(value => value !== f.foreign);
    expect(token.dispose()).toEqual({ removed: true });
    expect(token.dispose()).toEqual({ removed: false });
    wrapper?.(f.event);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(f.handlers).toEqual(new Set([f.foreign]));
    expect(Grids.registerOnLoad(f.grid, handler)).not.toBe(token);
  });
  it("rejects home grids, missing native remove and invalid handler before adding", () => {
    const f = loadFixture();
    f.grid.getGridType.mockReturnValue(1);
    expect(() => Grids.registerOnLoad(f.grid, () => undefined)).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_SURFACE" }));
    f.grid.getGridType.mockReturnValue(2);
    expect(() => Grids.registerOnLoad({ getGrid: f.grid.getGrid, getGridType: () => 2, addOnLoad: f.grid.addOnLoad }, () => undefined)).toThrow();
    expect(() => Reflect.apply(Grids.registerOnLoad, undefined, [f.grid, "handler"])).toThrow();
    expect(f.grid.addOnLoad).not.toHaveBeenCalled();
  });
  it("rejects forged event sources and stale native methods without invoking caller code", () => {
    const f = loadFixture(), handler = vi.fn();
    Grids.registerOnLoad(f.grid, handler);
    const wrapper = [...f.handlers].find(value => value !== f.foreign);
    expect(() => wrapper?.({ getEventSource: () => loadFixture().grid })).toThrowError(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
    f.grid.getGrid = () => { throw new Error("replaced"); };
    expect(f.fire).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_SURFACE" }));
    expect(handler).not.toHaveBeenCalled();
  });
  it("surfaces handler exceptions and invalid async/valued returns", async () => {
    for (const handler of [() => { throw new Error("caller"); }, () => 1, async () => { throw new Error("async caller"); }]) {
      const f = loadFixture();
      Grids.registerOnLoad(f.grid, handler);
      expect(f.fire).toThrowError(VbdError);
    }
    await Promise.resolve();
  });
  it("prevents recursive dispatch and preserves later lifecycle", () => {
    const f = loadFixture(), recurse = vi.fn(() => f.fire());
    const token = Grids.registerOnLoad(f.grid, recurse);
    expect(f.fire).toThrowError(expect.objectContaining({ code: "EVENT_REENTRY" }));
    expect(token.dispose().removed).toBe(true);
  });
  it("cleans an add that throws after native side effects", () => {
    const f = loadFixture();
    f.grid.addOnLoad.mockImplementation(handler => { f.handlers.add(handler); throw new Error("after add"); });
    expect(() => Grids.registerOnLoad(f.grid, vi.fn())).toThrowError(expect.objectContaining({ code: "SDK_OPERATION_FAILED" }));
    expect(f.handlers).toEqual(new Set([f.foreign]));
  });
  it("retains actionable disposal after uncertain add/cleanup and blocks false reuse", () => {
    const f = loadFixture(), handler = vi.fn();
    f.grid.addOnLoad.mockImplementation(value => { f.handlers.add(value); throw new Error("after add"); });
    f.grid.removeOnLoad.mockImplementation(() => { throw new Error("remove"); });
    let disposable: unknown;
    try { Grids.registerOnLoad(f.grid, handler); }
    catch (error) {
      expect(error).toBeInstanceOf(VbdError);
      if (error instanceof Error && typeof error.cause === "object" && error.cause !== null) disposable = Reflect.get(error.cause, "disposable");
    }
    expect(() => Grids.registerOnLoad(f.grid, handler)).toThrowError(expect.objectContaining({ code: "PARTIAL_FAILURE" }));
    f.grid.removeOnLoad.mockImplementation(value => { f.handlers.delete(value); });
    if (typeof disposable !== "object" || disposable === null) throw new Error("Missing recovery token");
    const dispose: unknown = Reflect.get(disposable, "dispose");
    if (typeof dispose !== "function") throw new Error("Missing recovery method");
    expect(Reflect.apply(dispose, disposable, [])).toEqual({ removed: true });
    expect(f.handlers).toEqual(new Set([f.foreign]));
  });
  it("retains failed disposal for a deliberate retry without adopting replaced native methods", () => {
    const f = loadFixture(), token = Grids.registerOnLoad(f.grid, vi.fn());
    f.grid.removeOnLoad.mockImplementationOnce(() => { throw new Error("remove"); });
    expect(() => token.dispose()).toThrowError(VbdError);
    expect(token.dispose().removed).toBe(true);
    expect(f.handlers).toEqual(new Set([f.foreign]));
  });
  it("bounds owned registrations independently of foreign handlers", () => {
    const f = loadFixture();
    const tokens = Array.from({ length: 100 }, () => Grids.registerOnLoad(f.grid, vi.fn()));
    expect(() => Grids.registerOnLoad(f.grid, vi.fn())).toThrowError(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
    for (const token of tokens) token.dispose();
    expect(f.handlers).toEqual(new Set([f.foreign]));
  });
});
