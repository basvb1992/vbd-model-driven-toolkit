import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { Execution } from "../src/execution.js";
import type { ReadCallbackContext, ReadRetryOptions } from "../src/execution.js";
import { Environment } from "../src/environment.js";
import { VbdError } from "../src/errors.js";
import { deferred, launchFixture } from "./environment-helpers.js";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date("2026-10-29T08:00:00Z"));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const zeroPolicy = { initialDelayMs: 0, maxDelayMs: 0 };
function setup() {
  const fixture = launchFixture();
  const options = { readOnly: true as const, context: fixture.context, policy: zeroPolicy };
  return { ...fixture, options };
}
async function failure(pending: Promise<unknown>): Promise<VbdError> {
  const error: unknown = await pending.then(() => undefined, (cause: unknown) => cause);
  expect(error).toBeInstanceOf(VbdError);
  return error as VbdError;
}

describe("Execution.withRetry: explicitly approved bounded reads", () => {
  it.each([false, 0, "", null, undefined])("preserves successful/falsy %s without platform reads", async value => {
    const f = setup(), callback = vi.fn(() => value);
    await expect(Execution.withRetry(callback, f.options)).resolves.toBe(value);
    expect(callback).toHaveBeenCalledOnce();
    expect(f.retrieve).not.toHaveBeenCalled();
  });
  it("preserves awaited values, strong callback/guard types and a frozen context", async () => {
    const f = setup(), controller = new AbortController();
    const value = { count: 1 };
    const pending = Execution.withRetry(async context => {
      expectTypeOf(context).toEqualTypeOf<ReadCallbackContext>();
      expect(context).toEqual({ attempt: 1, signal: controller.signal });
      expect(Object.isFrozen(context)).toBe(true);
      return value;
    }, { ...f.options, signal: controller.signal, guard: result => result.count === 1 });
    expectTypeOf(pending).toEqualTypeOf<Promise<{ count: number }>>();
    expect(await pending).toBe(value);
    expect(Object.keys(Execution).sort()).toEqual(["preflight", "withLock", "withRetry"]);
  });
  it.each([
    {}, { readOnly: false }, { readOnly: true, idempotent: true },
    { readOnly: true, mutation: false }, { readOnly: true, policy: { maxAttempts: 0 } },
    { readOnly: true, policy: { maxAttempts: 11 } },
    { readOnly: true, policy: { initialDelayMs: -1 } },
    { readOnly: true, policy: { initialDelayMs: 2, maxDelayMs: 1 } },
    { readOnly: true, policy: { maxDelayMs: 60_001 } },
    { readOnly: true, policy: { backoffFactor: Infinity } },
    { readOnly: true, policy: { backoffFactor: 0.9 } },
    { readOnly: true, policy: { maxTotalDelayMs: 300_001 } },
    { readOnly: true, policy: { maxElapsedMs: 0 } },
    { readOnly: true, policy: { maxElapsedMs: 300_001 } },
    { readOnly: true, policy: { retryWrites: true } },
    { readOnly: true, signal: {} }, { readOnly: true, guard: "eval" }
  ])("rejects unsafe/non-exact policy before dispatch: %j", async settings => {
    const f = setup(), callback = vi.fn();
    await expect(Reflect.apply(Execution.withRetry, undefined, [
      callback, { context: f.context, ...settings }
    ])).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(callback).not.toHaveBeenCalled();
  });
  it("rejects non-callable operations and unavailable/offline scope", async () => {
    const f = setup(), callback = vi.fn();
    await expect(Reflect.apply(Execution.withRetry, undefined, [null, f.options]))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    f.scope.online = false;
    await expect(Execution.withRetry(callback, f.options)).rejects.toMatchObject({ code: "UNSUPPORTED_SURFACE" });
    vi.stubGlobal("Xrm", undefined);
    await expect(Execution.withRetry(callback, { readOnly: true })).rejects.toMatchObject({ code: "UNSUPPORTED_SURFACE" });
    expect(callback).not.toHaveBeenCalled();
  });
  it.each([408, 429, 502, 503, 504])("retries positively retained HTTP %i only", async status => {
    const f = setup(), contexts: number[] = [];
    const callback = vi.fn((context: ReadCallbackContext) => {
      contexts.push(context.attempt);
      if (context.attempt < 3) throw { status };
      return false;
    });
    expect(await Execution.withRetry(callback, f.options)).toBe(false);
    expect(contexts).toEqual([1, 2, 3]);
  });
  it.each([400, 401, 403, 404, 409, 412, 422, 500, 501, "429", NaN])(
    "does not retry unsupported/uncertain status %s", async status => {
      const f = setup(), original = { status, message: "PRIVATE_CANARY retry 503 Retry-After: 0" };
      const callback = vi.fn(() => { throw original; });
      const error = await failure(Execution.withRetry(callback, f.options));
      expect(error.cause).toBe(original);
      expect(String(error)).not.toContain("PRIVATE_CANARY");
      expect(callback).toHaveBeenCalledOnce();
    });
  it.each([
    new Error("429 Retry-After: 0"), new TypeError("Failed to fetch"), { errorCode: 429 },
    new VbdError("DATA_READ_FAILED", { operation: "test.read" })
  ])("does not infer safety from names, text or VbdError code: %j", async original => {
    const f = setup(), callback = vi.fn(function retrieveSafeRead() { throw original; });
    const error = await failure(Execution.withRetry(callback, f.options));
    expect(original instanceof VbdError ? error : error.cause).toBe(original);
    expect(callback).toHaveBeenCalledOnce();
  });
  it.each(["DATA_READ_FAILED", "SDK_OPERATION_FAILED", "OPERATION_FAILED"] as const)(
    "requires retained status through approved %s wrapper", async code => {
      const f = setup(), original = new VbdError(code, { operation: "test.read", cause: { status: 503 } });
      const callback = vi.fn(() => { throw original; });
      expect(await failure(Execution.withRetry(callback, f.options))).toBe(original);
      expect(callback).toHaveBeenCalledTimes(3);
    });
  it.each([
    "ACCESS_DENIED", "INVALID_ARGUMENT", "CONFIG_VALUE_INVALID", "CONCURRENCY_CONFLICT",
    "DATA_WRITE_FAILED", "ACTION_FAILED", "MUTATION_OUTCOME_UNKNOWN", "PARTIAL_FAILURE"
  ] as const)("never retries %s even with a retained 503", async code => {
    const f = setup(), original = new VbdError(code, { operation: "test.write", cause: { status: 503 } });
    const callback = vi.fn(() => { throw original; });
    await expect(Execution.withRetry(callback, f.options)).rejects.toBe(original);
    expect(callback).toHaveBeenCalledOnce();
  });
  it("rejects accessors, inherited evidence, reflective failures and cause cycles without executing getters", async () => {
    const f = setup(), getter = vi.fn(() => 503);
    const cyclic = new VbdError("DATA_READ_FAILED", { operation: "test.read" });
    Object.defineProperty(cyclic, "cause", { value: cyclic });
    const cases: unknown[] = [
      Object.defineProperty({}, "status", { get: getter }),
      Object.create({ status: 503 }),
      Object.defineProperty({ status: 503 }, "retryAfter", { get: getter }),
      new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error("PRIVATE_PROXY"); } }),
      cyclic
    ];
    for (const original of cases) {
      const callback = vi.fn(() => { throw original; });
      await failure(Execution.withRetry(callback, f.options));
      expect(callback).toHaveBeenCalledOnce();
    }
    expect(getter).not.toHaveBeenCalled();
  });
  it("uses finite capped exponential delays and inclusive total scheduled wait", async () => {
    const f = setup(), times: number[] = [];
    const callback = vi.fn((context: ReadCallbackContext) => {
      times.push(performance.now());
      if (context.attempt < 4) throw { status: 429 };
      return "done";
    });
    const pending = Execution.withRetry(callback, { ...f.options, policy: {
      maxAttempts: 4, initialDelayMs: 10, backoffFactor: 4, maxDelayMs: 25, maxTotalDelayMs: 60
    } });
    await vi.runAllTimersAsync();
    expect(await pending).toBe("done");
    expect(times).toEqual([0, 10, 35, 60]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("defaults to three attempts and 250/500 ms delays", async () => {
    const f = setup(), original = { status: 503 }, times: number[] = [];
    const callback = vi.fn(() => { times.push(performance.now()); throw original; });
    const pending = failure(Execution.withRetry(callback, { readOnly: true, context: f.context }));
    await vi.runAllTimersAsync();
    expect((await pending).cause).toBe(original);
    expect(times).toEqual([0, 250, 750]);
  });
  it.each([1, 10])("includes first dispatch in the exact %i attempt cap", async maxAttempts => {
    const f = setup(), original = { status: 503 }, callback = vi.fn(() => { throw original; });
    expect((await failure(Execution.withRetry(callback, {
      ...f.options, policy: { ...zeroPolicy, maxAttempts }
    }))).cause).toBe(original);
    expect(callback).toHaveBeenCalledTimes(maxAttempts);
  });
  it.each([9, 0])("does not schedule a delay exceeding total budget %i", async maxTotalDelayMs => {
    const f = setup(), original = { status: 503 }, callback = vi.fn(() => { throw original; });
    const error = await failure(Execution.withRetry(callback, {
      ...f.options, policy: { initialDelayMs: 10, maxTotalDelayMs }
    }));
    expect(error.cause).toBe(original);
    expect(callback).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([0, "0", 1, "1", "Thu, 29 Oct 2026 08:00:01 GMT", "Thu, 29 Oct 2026 07:59:59 GMT"])(
    "respects explicit bounded Retry-After %s", async retryAfter => {
      const f = setup();
      const callback = vi.fn((context: ReadCallbackContext) => {
        if (context.attempt === 1) throw { status: 429, retryAfter };
        return performance.now();
      });
      const pending = Execution.withRetry(callback, {
        ...f.options, policy: { initialDelayMs: 5, maxDelayMs: 1000, maxTotalDelayMs: 1000 }
      });
      await vi.runAllTimersAsync();
      expect(await pending).toBe([1, "1", "Thu, 29 Oct 2026 08:00:01 GMT"].includes(retryAfter) ? 1000 : 5);
    });
  it.each([
    -1, 1.5, Infinity, NaN, "1.5", "-1", " 1", "1e0", "bogus", "Retry-After: 1",
    "Wed, 29 Oct 2026 08:00:01 GMT", "Thu, 32 Oct 2026 08:00:01 GMT",
    "Thu, 29 Oct 2026 08:00:02 GMT", 2, "99999999999", null, {}
  ])("does not retry malformed or over-maximum Retry-After %j", async retryAfter => {
    const f = setup(), original = { status: 429, retryAfter }, callback = vi.fn(() => { throw original; });
    expect((await failure(Execution.withRetry(callback, {
      ...f.options, policy: { initialDelayMs: 0, maxDelayMs: 1000 }
    }))).cause).toBe(original);
    expect(callback).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not clamp Retry-After to a smaller total or elapsed budget", async () => {
    const f = setup(), original = { status: 429, retryAfter: 1 };
    for (const policy of [
      { initialDelayMs: 0, maxDelayMs: 1000, maxTotalDelayMs: 999 },
      { initialDelayMs: 0, maxDelayMs: 1000, maxElapsedMs: 1000 }
    ]) {
      const callback = vi.fn(() => { throw original; });
      expect((await failure(Execution.withRetry(callback, { ...f.options, policy }))).cause).toBe(original);
      expect(callback).toHaveBeenCalledOnce();
    }
  });
  it("rejects late successful work at the exact elapsed bound, including suspended wall time", async () => {
    const f = setup();
    const callback = vi.fn(() => { vi.setSystemTime(Date.now() + 100); return 1; });
    await expect(Execution.withRetry(callback, { ...f.options, policy: { maxElapsedMs: 100 } }))
      .rejects.toMatchObject({ code: "LIMIT_EXCEEDED", cause: { reason: "elapsed-budget" } });
    expect(callback).toHaveBeenCalledOnce();
  });
  it("uses monotonic elapsed time despite a backwards wall clock", async () => {
    const f = setup(), gate = deferred(), callback = vi.fn(async () => { await gate.promise; return 1; });
    const pending = failure(Execution.withRetry(callback, { ...f.options, policy: { maxElapsedMs: 10 } }));
    await vi.advanceTimersByTimeAsync(10);
    vi.setSystemTime(Date.now() - 10_000);
    gate.release();
    expect(await pending).toMatchObject({ code: "LIMIT_EXCEEDED" });
  });
  it("cancels before dispatch and never propagates private signal reasons", async () => {
    const f = setup(), controller = new AbortController(), callback = vi.fn();
    controller.abort(new Error("PRIVATE_CANCEL"));
    const error = await failure(Execution.withRetry(callback, { ...f.options, signal: controller.signal }));
    expect(error).toMatchObject({ code: "OPERATION_FAILED", cause: { reason: "cancelled" } });
    expect(JSON.stringify(error)).not.toContain("PRIVATE_CANCEL");
    expect(callback).not.toHaveBeenCalled();
  });
  it("cancels a delay, cleans its timer/listener and retains the original failure", async () => {
    const f = setup(), controller = new AbortController(), original = { status: 429 };
    const add = vi.spyOn(controller.signal, "addEventListener"), remove = vi.spyOn(controller.signal, "removeEventListener");
    const callback = vi.fn(() => { throw original; });
    const pending = failure(Execution.withRetry(callback, { ...f.options, signal: controller.signal, policy: { initialDelayMs: 100 } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();
    expect(await pending).toMatchObject({ cause: { reason: "cancelled", evidence: original } });
    expect(callback).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledTimes(add.mock.calls.length);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("drains cancelled in-flight work without racing or retrying uncertain completion", async () => {
    const f = setup(), controller = new AbortController(), gate = deferred(), original = { status: 503 };
    let done = false;
    const callback = vi.fn(async () => { await gate.promise; throw original; });
    const pending = failure(Execution.withRetry(callback, { ...f.options, signal: controller.signal })).then(error => {
      done = true; return error;
    });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.runAllTimersAsync();
    expect(done).toBe(false);
    gate.release();
    expect(await pending).toMatchObject({ cause: { reason: "cancelled", evidence: original } });
    expect(callback).toHaveBeenCalledOnce();
  });
  it.each(["environment", "user", "language", "generation"] as const)(
    "rejects %s changes before dispatch", async changed => {
      const f = setup(), callback = vi.fn();
      const pending = Execution.withRetry(callback, f.options);
      if (changed === "environment") f.scope.environmentUrl = "https://other.example";
      if (changed === "user") f.scope.userId = crypto.randomUUID();
      if (changed === "language") f.scope.languageId = 1043;
      if (changed === "generation") Environment.invalidate(undefined, { context: f.context });
      await expect(pending).rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
      expect(callback).not.toHaveBeenCalled();
    });
  it.each(["callback", "delay", "guard"] as const)("rejects scope changes around %s and retains failures", async where => {
    const f = setup(), original = { status: 503 };
    const callback = vi.fn(() => {
      if (where === "callback") { f.scope.languageId = 1043; throw original; }
      if (where === "delay") throw original;
      return 1;
    });
    const pending = failure(Execution.withRetry(callback, {
      ...f.options, policy: { initialDelayMs: 100 },
      guard: () => { if (where === "guard") f.scope.languageId = 1043; return true; }
    }));
    if (where === "delay") {
      await vi.advanceTimersByTimeAsync(0);
      Environment.invalidate(undefined, { context: f.context });
      await vi.runAllTimersAsync();
    }
    const error = await pending;
    expect(error.code).toBe("CONFIG_EXPIRED");
    if (where !== "guard") expect(error.cause).toMatchObject({ evidence: original });
    expect(callback).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not retry invalid guards, including a retained transient status", async () => {
    const f = setup(), cause = { status: 503 };
    for (const guard of [() => false, () => { throw cause; }]) {
      const callback = vi.fn(() => 1);
      expect(await failure(Execution.withRetry(callback, { ...f.options, guard })))
        .toMatchObject({ code: "CONFIG_VALUE_INVALID" });
      expect(callback).toHaveBeenCalledOnce();
    }
  });
  it("drains an invalid async guard and rechecks scope after its rejection", async () => {
    const f = setup(), gate = deferred(), original = new Error("PRIVATE_GUARD");
    const guard = vi.fn(async () => { await gate.promise; throw original; });
    const callback = vi.fn(() => 1);
    const options: ReadRetryOptions<number> = { ...f.options };
    // Runtime-hostile JavaScript caller: TypeScript correctly excludes async guards.
    let finished = false;
    const pending = failure(Reflect.apply(Execution.withRetry, undefined, [
      callback, { ...options, guard }
    ]) as Promise<unknown>).then(error => { finished = true; return error; });
    await vi.advanceTimersByTimeAsync(0);
    expect(finished).toBe(false);
    Environment.invalidate(undefined, { context: f.context });
    gate.release();
    expect(await pending).toMatchObject({
      code: "CONFIG_EXPIRED", cause: { evidence: { code: "CONFIG_VALUE_INVALID", cause: original } }
    });
    expect(callback).toHaveBeenCalledOnce();
  });
  it("holds the exact eight-run shared admission cap until unresolved callbacks drain", async () => {
    const f = setup(), gate = deferred(), callback = vi.fn(() => gate.promise);
    const pending = Array.from({ length: 8 }, () => Execution.withRetry(callback, f.options));
    try {
      await expect(Execution.withRetry(callback, f.options)).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
      await expect(Execution.preflight([{ id: "read", readOnly: true, run: () => ({ status: "pass", reason: "confirmed" }) }],
        { context: f.context })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    } finally { gate.release(); await Promise.all(pending); }
    await expect(Execution.withRetry(() => 0, f.options)).resolves.toBe(0);
  });
  it("does not launch a duplicate while an admitted read is still unresolved", async () => {
    const f = setup(), gate = deferred(), original = { status: 503 };
    const callback = vi.fn(async (context: ReadCallbackContext) => {
      if (context.attempt === 1) { await gate.promise; throw original; }
      return 0;
    });
    const pending = Execution.withRetry(callback, f.options);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(callback).toHaveBeenCalledOnce();
    gate.release();
    await expect(pending).resolves.toBe(0);
    expect(callback).toHaveBeenCalledTimes(2);
  });
  it("drains late failures but rejects at the elapsed bound without another attempt", async () => {
    const f = setup(), gate = deferred(), original = { status: 503 };
    const callback = vi.fn(async () => { await gate.promise; throw original; });
    let done = false;
    const pending = failure(Execution.withRetry(callback, {
      ...f.options, policy: { ...zeroPolicy, maxElapsedMs: 10 }
    })).then(error => { done = true; return error; });
    await vi.advanceTimersByTimeAsync(10);
    expect(done).toBe(false);
    gate.release();
    expect(await pending).toMatchObject({
      code: "LIMIT_EXCEEDED", cause: { reason: "elapsed-budget", evidence: original }
    });
    expect(callback).toHaveBeenCalledOnce();
  });
  it("checks wall elapsed after a suspended delay without admitting a retry", async () => {
    const f = setup(), original = { status: 503 }, callback = vi.fn(() => { throw original; });
    const pending = failure(Execution.withRetry(callback, {
      ...f.options, policy: { initialDelayMs: 5, maxElapsedMs: 10 }
    }));
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(Date.now() + 100_000);
    await vi.advanceTimersByTimeAsync(5);
    expect(await pending).toMatchObject({ code: "LIMIT_EXCEEDED", cause: { evidence: original } });
    expect(callback).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["callback", "guard"] as const)("checks cancellation immediately after %s", async phase => {
    const f = setup(), controller = new AbortController();
    const callback = vi.fn(() => { if (phase === "callback") controller.abort(); return 1; });
    const guard = vi.fn(() => { controller.abort(); return true; });
    const pending = Execution.withRetry(callback, { ...f.options, signal: controller.signal, guard });
    await expect(pending).rejects.toMatchObject({ code: "OPERATION_FAILED", cause: { reason: "cancelled" } });
    expect(callback).toHaveBeenCalledOnce();
    expect(guard).toHaveBeenCalledTimes(phase === "callback" ? 0 : 1);
  });
  it("observes rejecting thenables and rechecks scope after pending failures", async () => {
    const f = setup(), gate = deferred(), original = { status: 503 };
    const callback = vi.fn(async () => { await gate.promise; throw original; });
    const pending = failure(Execution.withRetry(callback, f.options));
    await vi.advanceTimersByTimeAsync(0);
    f.scope.userId = crypto.randomUUID();
    gate.release();
    expect(await pending).toMatchObject({ code: "CONFIG_EXPIRED", cause: { evidence: original } });
    expect(callback).toHaveBeenCalledOnce();
    const thenable = { then: () => { throw original; } };
    const rejected = await failure(Reflect.apply(Execution.withRetry, undefined, [
      () => thenable, { ...f.options, policy: { maxAttempts: 1 } }
    ]) as Promise<unknown>);
    expect(rejected.cause).toBe(original);
  });
  it("rejects scope changes from throwing guards without losing original evidence", async () => {
    const f = setup(), original = { status: 503 };
    const pending = Execution.withRetry(() => 1, {
      ...f.options, guard: () => { f.scope.languageId = 1043; throw original; }
    });
    await expect(pending).rejects.toMatchObject({
      code: "CONFIG_EXPIRED", cause: { evidence: { code: "CONFIG_VALUE_INVALID", cause: original } }
    });
  });
  it("drains invalid async guards even if they resolve true and never treats them as success", async () => {
    const f = setup(), gate = deferred();
    const guard = vi.fn(async () => { await gate.promise; return true; });
    const callback = vi.fn(() => 0);
    let done = false;
    const pending = failure(Reflect.apply(Execution.withRetry, undefined, [
      callback, { ...f.options, guard }
    ]) as Promise<unknown>).then(error => { done = true; return error; });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    gate.release();
    expect(await pending).toMatchObject({ code: "CONFIG_VALUE_INVALID" });
    expect(callback).toHaveBeenCalledOnce();
  });
  it("cleans every completed retry-delay listener and accepts the exact 60 second header maximum", async () => {
    const f = setup(), controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener"), remove = vi.spyOn(controller.signal, "removeEventListener");
    const callback = vi.fn((context: ReadCallbackContext) => {
      if (context.attempt < 3) throw { status: 429, retryAfter: 60 };
      return performance.now();
    });
    const pending = Execution.withRetry(callback, {
      ...f.options, signal: controller.signal,
      policy: { initialDelayMs: 0, maxDelayMs: 60_000, maxTotalDelayMs: 120_000, maxElapsedMs: 120_001 }
    });
    await vi.runAllTimersAsync();
    expect(await pending).toBe(120_000);
    expect(add).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cleans a failing structural signal listener and keeps delay and original failure evidence safe", async () => {
    const f = setup(), original = { status: 503 }, listenerError = new Error("PRIVATE_LISTENER");
    const signal = {
      aborted: false,
      addEventListener: () => { throw listenerError; },
      removeEventListener: vi.fn()
    };
    const error = await failure(Reflect.apply(Execution.withRetry, undefined, [
      () => { throw original; }, { ...f.options, signal, policy: { initialDelayMs: 5 } }
    ]) as Promise<unknown>);
    expect(error).toMatchObject({ code: "OPERATION_FAILED", cause: { delay: listenerError, evidence: original } });
    expect(signal.removeEventListener).toHaveBeenCalledOnce();
    expect(JSON.stringify(error)).not.toContain("PRIVATE_LISTENER");
    expect(vi.getTimerCount()).toBe(0);
  });
});
