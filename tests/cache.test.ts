import { afterEach, describe, expect, it, vi } from "vitest";
import { Cache } from "../src/cache.js";
import type { CacheLoadOptions } from "../src/cache.js";
import { Environment } from "../src/environment.js";
import { deferred, launchFixture } from "./environment-helpers.js";

afterEach(() => { vi.useRealTimers(); });
const key = (name = "entry") => ({ namespace: `cache-${crypto.randomUUID()}`, key: name });
const jsonGuard = (value: unknown): value is unknown => { void value; return true; };
function settings(host = launchFixture()): CacheLoadOptions<unknown> {
  return {
    context: host.context, approved: true, purpose: "configuration", revision: "v1",
    ttlMs: 1000, load: async () => ({ flag: false, count: 0, title: "" }), validate: jsonGuard
  };
}
describe("bounded memory-only safe configuration cache", () => {
  it.each([false, 0, "", null])("caches %s without truthiness defaults", async value => {
    const input = settings(), identity = key(), load = vi.fn(async () => value);
    expect(await Cache.getOrLoad(identity, { ...input, load })).toBe(value);
    expect(await Cache.getOrLoad(identity, { ...input, load })).toBe(value);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent loads and isolates source, predicate, and returned copies", async () => {
    const input = settings(), identity = key(), gate = deferred();
    const original = { nested: { count: 0 } };
    const load = vi.fn(async () => { await gate.promise; return original; });
    const validate = (value: unknown): value is { nested: { count: number } } => {
      if (typeof value !== "object" || value === null || !("nested" in value) ||
          typeof value.nested !== "object" || value.nested === null || !("count" in value.nested)) return false;
      value.nested.count = 999;
      return true;
    };
    const first = Cache.getOrLoad(identity, { ...input, load, validate });
    const second = Cache.getOrLoad(identity, { ...input, load, validate });
    gate.release();
    const values = await Promise.all([first, second]);
    expect(values).toEqual([{ nested: { count: 0 } }, { nested: { count: 0 } }]);
    values[0]!.nested.count = 2;
    original.nested.count = 3;
    expect(await Cache.getOrLoad(identity, { ...input, load, validate })).toEqual({ nested: { count: 0 } });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("expires finite TTLs and does not cache loader or validator failures", async () => {
    vi.useFakeTimers();
    const identity = key(), input = settings(), load = vi.fn(input.load);
    await Cache.getOrLoad(identity, { ...input, load });
    vi.advanceTimersByTime(1000);
    await Cache.getOrLoad(identity, { ...input, load });
    expect(load).toHaveBeenCalledTimes(2);
    await expect(Cache.getOrLoad(identity, { ...input, validate: (() => false) as never }))
      .rejects.toMatchObject({ code: "CONFIG_VALUE_INVALID" });
    await Cache.getOrLoad(identity, { ...input, load });
    expect(load).toHaveBeenCalledTimes(3);
    const failed = vi.fn(async () => { throw new Error("read-error"); });
    const other = key();
    for (let i = 0; i < 2; i++) {
      await expect(Cache.getOrLoad(other, { ...input, load: failed })).rejects.toMatchObject({ code: "DATA_READ_FAILED" });
    }
    expect(failed).toHaveBeenCalledTimes(2);
  });

  it.each([
    { approved: false }, { purpose: "records" }, { ttlMs: 0 }, { ttlMs: Infinity },
    { ttlMs: 300_001 }, { maxBytes: 262_145 }, { revision: "" }, { dependencies: ["x", "x"] }
  ])("rejects invalid approval/policy %j", async override => {
    const load = vi.fn(async () => ({}));
    await expect(Cache.getOrLoad(key(), { ...settings(), load, ...override } as never))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(load).not.toHaveBeenCalled();
  });

  it.each([
    new Date(), { x: undefined }, { x: Infinity }, "x".repeat(65_537),
    JSON.parse('{"constructor":{}}') as unknown
  ])("rejects non-JSON, unsafe or oversized values", async value => {
    await expect(Cache.getOrLoad(key(), { ...settings(), load: async () => value })).rejects.toBeDefined();
  });
  it("rejects cycles, getters, deep/large JSON and configured size overflow", async () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    const getter = vi.fn(() => "never");
    const accessor = Object.defineProperty({}, "value", { enumerable: true, get: getter });
    let deep: unknown = {};
    for (let i = 0; i < 10; i++) deep = { deep };
    for (const value of [cycle, accessor, deep, Array.from({ length: 1001 }, () => 1)]) {
      await expect(Cache.getOrLoad(key(), { ...settings(), load: async () => value })).rejects.toBeDefined();
    }
    expect(getter).not.toHaveBeenCalled();
    await expect(Cache.getOrLoad(key(), { ...settings(), maxBytes: 5 })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  });

  it.each(["invalidate", "dependency", "clear", "revision", "environment", "scope", "validator"] as const)(
    "prevents stale repopulation after %s", async change => {
      const host = launchFixture(), identity = key(), input = settings(host), gate = deferred();
      const load = vi.fn(async () => { await gate.promise; return { old: true }; });
      const pending = Cache.getOrLoad(identity, { ...input, load, dependencies: ["definition"] });
      await Promise.resolve();
      if (change === "invalidate") expect(Cache.invalidate(identity, { context: host.context })).toBe(1);
      if (change === "dependency") expect(Cache.invalidate({
        namespace: identity.namespace, dependency: "definition"
      }, { context: host.context })).toBe(1);
      if (change === "clear") expect(Cache.clear({ context: host.context })).toBe(1);
      if (change === "environment") Environment.invalidate(undefined, { context: host.context });
      if (change === "scope") host.scope.userId = crypto.randomUUID();
      if (change === "revision" || change === "validator") {
        Cache.invalidate(identity, { context: host.context });
      }
      const fresh = await Cache.getOrLoad(identity, { ...input, revision: "v2", load: async () => ({ fresh: true }) });
      expect(fresh).toEqual({ fresh: true });
      gate.release();
      await expect(pending).rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
      expect(await Cache.getOrLoad(identity, { ...input, revision: "v2" })).toEqual({ fresh: true });
    }
  );

  it("a revision change alone disconnects an old pending key", async () => {
    const identity = key(), input = settings(), gate = deferred();
    const old = Cache.getOrLoad(identity, { ...input, load: async () => { await gate.promise; return 0; } });
    await Promise.resolve();
    expect(await Cache.getOrLoad(identity, { ...input, revision: "v2", load: async () => 1 })).toBe(1);
    gate.release();
    await expect(old).rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
  });

  it.each(["invalidate", "scope", "environment"] as const)("rechecks %s after validators on miss and hit", async change => {
    for (const hit of [false, true]) {
      const host = launchFixture(), identity = key(), input = settings(host);
      if (hit) await Cache.getOrLoad(identity, input);
      const validate = (value: unknown): value is unknown => {
        void value;
        if (change === "invalidate") Cache.invalidate(identity, { context: host.context });
        if (change === "scope") host.scope.languageId = 1043;
        if (change === "environment") Environment.invalidate(undefined, { context: host.context });
        return true;
      };
      await expect(Cache.getOrLoad(identity, { ...input, validate })).rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
    }
  });

  it("rejects and observes asynchronous and throwing runtime predicates", async () => {
    const predicates = [
      async () => { throw new Error("rejected predicate"); },
      () => { throw new Error("throwing predicate"); },
      () => ({ then: async () => { throw new Error("rejecting then"); } })
    ];
    for (const validate of predicates) {
      await expect(Cache.getOrLoad(key(), { ...settings(), validate: validate as never }))
        .rejects.toMatchObject({ code: "CONFIG_VALUE_INVALID" });
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  it.each(["userId", "languageId", "environmentUrl"] as const)("partitions by %s and only clears the selected scope", async field => {
    const host = launchFixture(), identity = key(), input = settings(host), load = vi.fn(input.load);
    const original = { ...host.scope };
    await Cache.getOrLoad(identity, { ...input, load });
    if (field === "userId") host.scope.userId = crypto.randomUUID();
    if (field === "languageId") host.scope.languageId = 1043;
    if (field === "environmentUrl") host.scope.environmentUrl = "https://other.example";
    await Cache.getOrLoad(identity, { ...input, load });
    expect(load).toHaveBeenCalledTimes(2);
    expect(Cache.clear({ context: host.context })).toBe(1);
    Object.assign(host.scope, original);
    await Cache.getOrLoad(identity, { ...input, load });
    expect(load).toHaveBeenCalledTimes(2);
    expect(Cache.clear({ context: host.context })).toBe(1);
  });

  it("bounds global entry capacity and serialized size", async () => {
    const host = launchFixture(), input = settings(host), namespace = key().namespace;
    const load = vi.fn(async () => 0);
    for (let i = 0; i < 129; i++) await Cache.getOrLoad({ namespace, key: `k${i}` }, { ...input, load });
    expect(Cache.clear({ context: host.context })).toBe(128);
    const large = Array.from({ length: 5 }, () => "x".repeat(40_000));
    for (let i = 0; i < 6; i++) {
      await Cache.getOrLoad({ namespace, key: `large${i}` }, { ...input, load: async () => large });
    }
    expect(Cache.clear({ context: host.context })).toBe(5);
  });

  it("bounds concurrent loads even when invalidated loaders have not settled", async () => {
    const host = launchFixture(), input = settings(host), namespace = key().namespace, gate = deferred();
    const pending = Array.from({ length: 64 }, (_, i) => Cache.getOrLoad({ namespace, key: `k${i}` }, {
      ...input, load: async () => { await gate.promise; return i; }
    }));
    await expect(Cache.getOrLoad({ namespace, key: "overflow" }, input)).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect(Cache.clear({ context: host.context })).toBe(64);
    await expect(Cache.getOrLoad({ namespace, key: "stillActive" }, input)).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    gate.release();
    const results = await Promise.allSettled(pending);
    expect(results.every(result => result.status === "rejected")).toBe(true);
    expect(await Cache.getOrLoad({ namespace, key: "fresh" }, input)).toEqual({ flag: false, count: 0, title: "" });
  });

  it("expires entries when the clock moves backwards", async () => {
    vi.useFakeTimers();
    const input = settings(), identity = key(), load = vi.fn(input.load);
    await Cache.getOrLoad(identity, { ...input, load });
    vi.setSystemTime(Date.now() - 10_000);
    await Cache.getOrLoad(identity, { ...input, load });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not reuse values from an invalidated environment generation", async () => {
    const host = launchFixture(), input = settings(host), identity = key(), load = vi.fn(input.load);
    await Cache.getOrLoad(identity, { ...input, load });
    Environment.invalidate(undefined, { context: host.context });
    await Cache.getOrLoad(identity, { ...input, load });
    expect(load).toHaveBeenCalledTimes(2);
  });
});
