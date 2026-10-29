import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { Execution } from "../src/execution.js";
import type { PreflightCheck, PreflightObservation, PreflightReport } from "../src/execution.js";
import { Environment } from "../src/environment.js";
import { VbdError } from "../src/errors.js";
import { deferred, launchFixture } from "./environment-helpers.js";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date("2026-10-29T08:00:00Z"));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const pass: PreflightObservation = { status: "pass", reason: "confirmed" };
function check(id: string, value: PreflightObservation = pass, required = true): PreflightCheck {
  return { id, readOnly: true, required, run: () => value };
}
function setup() {
  const fixture = launchFixture();
  return { ...fixture, options: { context: fixture.context } };
}

describe("Execution.preflight: bounded read-only observations, not authorization", () => {
  it("returns an exact frozen ready report only when every check passes", async () => {
    const f = setup();
    const report = await Execution.preflight([check("required"), check("optional", pass, false)], f.options);
    expectTypeOf(report).toEqualTypeOf<PreflightReport>();
    expect(report).toEqual({
      status: "ready", basis: "trusted-read-only-checks", correlationId: expect.any(String),
      checks: [
        { id: "required", required: true, executed: true, status: "pass", reason: "confirmed" },
        { id: "optional", required: false, executed: true, status: "pass", reason: "confirmed" }
      ],
      counts: { total: 2, executed: 2, pass: 2, fail: 0, unknown: 0, unsupported: 0, observerFailed: 0 }
    });
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.checks)).toBe(true);
    expect(Object.isFrozen(report.checks[0])).toBe(true);
    expect(Object.isFrozen(report.counts)).toBe(true);
    expect(f.retrieve).not.toHaveBeenCalled();
  });
  it.each([
    [{ status: "fail", reason: "denied" }, true, "blocked"],
    [{ status: "fail", reason: "not-satisfied" }, true, "blocked"],
    [{ status: "fail", reason: "denied" }, false, "incomplete"],
    [{ status: "unknown", reason: "missing-data" }, true, "incomplete"],
    [{ status: "unknown", reason: "inconclusive" }, false, "incomplete"],
    [{ status: "unsupported", reason: "unavailable" }, true, "incomplete"],
    [{ status: "unsupported", reason: "unavailable" }, false, "incomplete"]
  ] as const)("computes meaningful thresholds for %j / required=%s", async (observation, required, status) => {
    const f = setup();
    const report = await Execution.preflight([check("ok"), check("evidence", observation, required)], f.options);
    expect(report.status).toBe(status);
    expect(report.checks[1]).toMatchObject({ ...observation, required, executed: true });
    expect(report.counts[observation.status]).toBe(1);
  });
  it("keeps required denial blocked alongside unknown and unsupported evidence", async () => {
    const f = setup();
    const report = await Execution.preflight([
      check("denied", { status: "fail", reason: "denied" }),
      check("missing", { status: "unknown", reason: "missing-data" }),
      check("unsupported", { status: "unsupported", reason: "unavailable" })
    ], f.options);
    expect(report.status).toBe("blocked");
    expect(report.counts).toEqual({ total: 3, executed: 3, pass: 0, fail: 1, unknown: 1, unsupported: 1, observerFailed: 0 });
  });
  it.each([
    [], Array.from({ length: 101 }, (_, i) => check(`check${i}`)),
    [check("same"), check("same")], [check("constructor")],
    [check("x".repeat(65))], [check("unsafe message text")],
    [{ ...check("write"), readOnly: false }], [{ id: "missing", run: () => pass }],
    [{ ...check("extra"), action: "navigate" }], [{ ...check("run"), run: "eval" }]
  ].map(checks => ({ checks })))("rejects non-exact/unapproved check plans before dispatch", async ({ checks }) => {
    const f = setup(), callback = vi.fn(() => pass);
    const input = checks.map(value => ({ ...value, ...(typeof value.run === "function" ? { run: callback } : {}) }));
    await expect(Reflect.apply(Execution.preflight, undefined, [input, f.options]))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(callback).not.toHaveBeenCalled();
  });
  it.each([
    { concurrency: 0 }, { concurrency: 9 }, { concurrency: 1.5 }, { maxElapsedMs: 0 },
    { maxElapsedMs: 300_001 }, { observer: "notify" }, { repair: true }, { signal: {} }
  ])("rejects non-exact option bounds %j", async extra => {
    const f = setup(), callback = vi.fn(() => pass);
    await expect(Reflect.apply(Execution.preflight, undefined, [
      [{ ...check("read"), run: callback }], { ...f.options, ...extra }
    ])).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(callback).not.toHaveBeenCalled();
  });
  it.each([undefined, null, false, 0, {}, { status: "pass" }, { status: "pass", reason: "denied" },
    { status: "pass", reason: "confirmed", payload: "PRIVATE_CANARY" },
    { status: "unknown", reason: "PRIVATE_CANARY" }
  ])("reports invalid/missing callback data %j as unknown, never success", async value => {
    const f = setup();
    const report = await Reflect.apply(Execution.preflight, undefined, [
      [{ ...check("invalid"), run: () => value }], f.options
    ]) as PreflightReport;
    expect(report).toMatchObject({ status: "incomplete", counts: { unknown: 1 } });
    expect(report.checks[0]).toMatchObject({ status: "unknown", reason: "invalid-observation", executed: true });
    expect(JSON.stringify(report)).not.toContain("PRIVATE_CANARY");
    expect(report.checks[0]?.diagnostic).toBeInstanceOf(VbdError);
    expect(Object.keys(report.checks[0] ?? {})).not.toContain("diagnostic");
  });
  it("does not execute observation getters and rechecks scope around reflective validation", async () => {
    const f = setup(), getter = vi.fn(() => "pass");
    const value = Object.defineProperty({ reason: "confirmed" }, "status", { enumerable: true, get: getter });
    const report = await Reflect.apply(Execution.preflight, undefined, [
      [{ ...check("getter"), run: () => value }], f.options
    ]) as PreflightReport;
    expect(report.checks[0]?.reason).toBe("invalid-observation");
    expect(getter).not.toHaveBeenCalled();
    const proxy = new Proxy({ ...pass }, {
      ownKeys: target => { f.scope.languageId = 1043; return Reflect.ownKeys(target); }
    });
    await expect(Execution.preflight([{ ...check("scope"), run: () => proxy }], f.options))
      .rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
  });
  it.each([
    new Error("PRIVATE_MESSAGE"), { status: 403, payload: "PRIVATE_PAYLOAD" },
    new VbdError("ACCESS_DENIED", { operation: "test.read", cause: "PRIVATE_CAUSE" })
  ])("retains failures non-enumerably with safe stable correlation %j", async original => {
    const f = setup(), run = vi.fn(() => { throw original; });
    const report = await Execution.preflight([{ ...check("failed"), run }], f.options);
    const result = report.checks[0];
    expect(result).toMatchObject({ status: "unknown", reason: "check-failed", executed: true, correlationId: expect.any(String) });
    expect(result?.diagnostic?.cause).toBe(original);
    expect(result?.diagnostic?.correlationId).toBe(result?.correlationId);
    expect(report.status).toBe("incomplete");
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE_|stack|payload|message|diagnostic/);
    expect(run).toHaveBeenCalledOnce();
  });
  it("accepts exactly 100 checks with stable ordering and concurrency 1..8", async () => {
    const f = setup();
    for (const concurrency of [1, 8]) {
      let active = 0, maximum = 0;
      const checks = Array.from({ length: 100 }, (_, i): PreflightCheck => ({
        ...check(`check${i}`), run: async context => {
          expect(context).toEqual({ attempt: 1 });
          active++; maximum = Math.max(active, maximum);
          await Promise.resolve();
          active--;
          return pass;
        }
      }));
      const report = await Execution.preflight(checks, { ...f.options, concurrency });
      expect(report.status).toBe("ready");
      expect(report.counts).toMatchObject({ total: 100, executed: 100, pass: 100 });
      expect(report.checks.map(result => result.id)).toEqual(checks.map(value => value.id));
      expect(maximum).toBe(concurrency);
    }
  });
  it("defaults to four concurrent checks and drains started work before advancing", async () => {
    const f = setup(), gate = deferred();
    const run = vi.fn(async () => { await gate.promise; return pass; });
    const pending = Execution.preflight(Array.from({ length: 5 }, (_, i) => ({ ...check(`c${i}`), run })), f.options);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(4);
    gate.release();
    expect((await pending).counts.executed).toBe(5);
  });
  it("records every pre-cancelled check explicitly, without callback/observer dispatch", async () => {
    const f = setup(), controller = new AbortController(), run = vi.fn(() => pass), observer = vi.fn();
    controller.abort(new Error("PRIVATE_CANCEL"));
    const report = await Execution.preflight([
      { ...check("first"), run }, { ...check("second"), run }
    ], { ...f.options, signal: controller.signal, observer });
    expect(report).toMatchObject({ status: "incomplete", counts: { total: 2, executed: 0, unknown: 2 } });
    expect(report.checks.map(value => [value.executed, value.reason])).toEqual([[false, "cancelled"], [false, "cancelled"]]);
    expect(run).not.toHaveBeenCalled();
    expect(observer).not.toHaveBeenCalled();
    expect(JSON.stringify(report)).not.toContain("PRIVATE_CANCEL");
  });
  it("drains a cancelled active callback; never drops waiting checks or repeats uncertain work", async () => {
    const f = setup(), controller = new AbortController(), gate = deferred(), original = { status: 503 };
    const run = vi.fn(async () => { await gate.promise; throw original; });
    let done = false;
    const pending = Execution.preflight([
      { ...check("active"), run }, { ...check("waiting"), run }
    ], { ...f.options, concurrency: 1, signal: controller.signal }).then(report => { done = true; return report; });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.runAllTimersAsync();
    expect(done).toBe(false);
    expect(run).toHaveBeenCalledOnce();
    gate.release();
    const report = await pending;
    expect(report.checks).toMatchObject([
      { executed: true, status: "unknown", reason: "cancelled" },
      { executed: false, status: "unknown", reason: "cancelled" }
    ]);
    expect(report.checks[0]?.diagnostic?.cause).toBeDefined();
    expect(report.status).toBe("incomplete");
    expect(run).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("marks late results and remaining checks unknown at the exact elapsed bound", async () => {
    const f = setup(), later = vi.fn(() => pass);
    const report = await Execution.preflight([
      { ...check("late"), run: () => { vi.setSystemTime(Date.now() + 10); return pass; } },
      { ...check("not-started"), run: later }
    ], { ...f.options, concurrency: 1, maxElapsedMs: 10 });
    expect(report.status).toBe("incomplete");
    expect(report.counts).toMatchObject({ total: 2, executed: 1, unknown: 2 });
    expect(report.checks.map(result => result.reason)).toEqual(["elapsed-budget", "elapsed-budget"]);
    expect(later).not.toHaveBeenCalled();
  });
  it.each(["environment", "user", "language", "generation"] as const)(
    "rejects %s changes between admission and dispatch", async difference => {
      const f = setup(), run = vi.fn(() => pass);
      const pending = Execution.preflight([{ ...check("read"), run }], f.options);
      if (difference === "environment") f.scope.environmentUrl = "https://other.example";
      if (difference === "user") f.scope.userId = crypto.randomUUID();
      if (difference === "language") f.scope.languageId = 1043;
      if (difference === "generation") Environment.invalidate(undefined, { context: f.context });
      await expect(pending).rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
      expect(run).not.toHaveBeenCalled();
    });
  it("drains parallel callbacks after a scope failure and stops new dispatch", async () => {
    const f = setup(), first = deferred(), second = deferred(), later = vi.fn(() => pass);
    const pending = Execution.preflight([
      { ...check("one"), run: async () => { await first.promise; return pass; } },
      { ...check("two"), run: async () => { await second.promise; throw new Error("PRIVATE_SECOND"); } },
      { ...check("three"), run: later }
    ], { ...f.options, concurrency: 2 });
    let done = false;
    const observed = pending.then(() => undefined, (error: unknown) => { done = true; return error; });
    await vi.advanceTimersByTimeAsync(0);
    Environment.invalidate(undefined, { context: f.context });
    first.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    expect(later).not.toHaveBeenCalled();
    second.release();
    expect(await observed).toMatchObject({ code: "CONFIG_EXPIRED" });
    expect(later).not.toHaveBeenCalled();
  });
  it("reports safe observer success without exposing raw original diagnostics", async () => {
    const f = setup(), observer = vi.fn();
    const report = await Execution.preflight([
      { ...check("failed"), run: () => { throw new Error("PRIVATE_CANARY"); } }
    ], { ...f.options, observer });
    expect(observer).toHaveBeenCalledOnce();
    const evidence = observer.mock.calls[0]?.[0] as unknown;
    expect(evidence).toMatchObject({ status: "unknown", reason: "check-failed" });
    expect(evidence).not.toHaveProperty("diagnostic");
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(report.checks[0]?.observer).toBe("reported");
    expect(report.status).toBe("incomplete");
  });
  it.each([pass, { status: "fail", reason: "denied" } as const])(
    "failed observers remain visible and cannot authorize %j", async observation => {
      const f = setup(), original = new Error("PRIVATE_OBSERVER");
      const report = await Execution.preflight([check("evidence", observation)], {
        ...f.options, observer: async () => { throw original; }
      });
      const result = report.checks[0];
      expect(report.status).toBe(observation.status === "fail" ? "blocked" : "incomplete");
      expect(report.counts.observerFailed).toBe(1);
      expect(result).toMatchObject({ ...observation, observer: "failed", observerCorrelationId: expect.any(String) });
      expect(result?.observerDiagnostic?.cause).toBe(original);
      expect(result?.observerDiagnostic?.code).toBe("DIAGNOSTIC_SINK_FAILED");
      expect(JSON.stringify(report)).not.toMatch(/PRIVATE_|stack|message|Diagnostic/);
    });
  it("rechecks scope after observer failures and does not dispatch subsequent checks", async () => {
    const f = setup(), later = vi.fn(() => pass);
    await expect(Execution.preflight([check("one"), { ...check("two"), run: later }], {
      ...f.options, concurrency: 1, observer: () => {
        Environment.invalidate(undefined, { context: f.context });
        throw new Error("PRIVATE_OBSERVER_SCOPE");
      }
    })).rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
    expect(later).not.toHaveBeenCalled();
  });
  it("drains unresolved observers and makes a late observer result incomplete", async () => {
    const f = setup(), gate = deferred();
    let done = false;
    const pending = Execution.preflight([check("read")], {
      ...f.options, maxElapsedMs: 10, observer: () => gate.promise
    }).then(report => { done = true; return report; });
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(false);
    gate.release();
    const report = await pending;
    expect(report.status).toBe("incomplete");
    expect(report.checks[0]).toMatchObject({ status: "unknown", reason: "elapsed-budget", observer: "reported" });
  });
  it("bounds eight simultaneous preflights / 64 active check callbacks and releases only after drain", async () => {
    const f = setup(), gate = deferred(), run = vi.fn(async () => { await gate.promise; return pass; });
    const checks = Array.from({ length: 8 }, (_, i) => ({ ...check(`read${i}`), run }));
    const pending = Array.from({ length: 8 }, () => Execution.preflight(checks, { ...f.options, concurrency: 8 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(64);
    try {
      await expect(Execution.preflight(checks, f.options)).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    } finally { gate.release(); await Promise.all(pending); }
    expect((await Execution.preflight([check("next")], f.options)).status).toBe("ready");
  });
  it("does not turn a late observer or cancellation into success, or erase a known denial", async () => {
    const f = setup(), controller = new AbortController(), gate = deferred();
    const pending = Execution.preflight([
      check("denied", { status: "fail", reason: "denied" }), check("waiting")
    ], { ...f.options, concurrency: 1, signal: controller.signal, observer: () => gate.promise });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    gate.release();
    const report = await pending;
    expect(report.status).toBe("blocked");
    expect(report.checks).toMatchObject([
      { status: "fail", reason: "denied", executed: true },
      { status: "unknown", reason: "cancelled", executed: false }
    ]);
  });
  it("keeps check and observer failures independently correlated and redacted", async () => {
    const f = setup(), original = new Error("PRIVATE_CHECK"), observerError = new Error("PRIVATE_OBSERVER");
    const report = await Execution.preflight([
      { ...check("read"), run: () => { throw original; } }
    ], { ...f.options, observer: () => { throw observerError; } });
    const evidence = report.checks[0];
    expect(evidence?.diagnostic?.cause).toBe(original);
    expect(evidence?.observerDiagnostic?.cause).toBe(observerError);
    expect(evidence?.correlationId).not.toBe(evidence?.observerCorrelationId);
    expect(evidence?.observerDiagnostic?.correlationId).toBe(evidence?.observerCorrelationId);
    expect(report.status).toBe("incomplete");
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE_|stack|message|diagnostic/);
  });
  it("cannot mutate observer evidence into a passing observation", async () => {
    const f = setup();
    const report = await Execution.preflight([check("denied", { status: "fail", reason: "denied" })], {
      ...f.options, observer: evidence => { Object.assign(evidence, { status: "pass" }); }
    });
    expect(report.status).toBe("blocked");
    expect(report.checks[0]).toMatchObject({ status: "fail", observer: "failed" });
  });
  it("rejects unexpected worker failures rather than returning sparse/null or success-shaped evidence", async () => {
    const f = setup(), original = new Error("PRIVATE_SIGNAL"), gate = deferred();
    let broken = false;
    const signal = {
      get aborted() { if (broken) throw original; return false; },
      addEventListener: vi.fn(), removeEventListener: vi.fn()
    };
    const pending = Reflect.apply(Execution.preflight, undefined, [
      [{ ...check("one"), run: async () => { await gate.promise; broken = true; return pass; } }, check("two")],
      { ...f.options, signal, concurrency: 1 }
    ]) as Promise<PreflightReport>;
    await vi.advanceTimersByTimeAsync(0);
    gate.release();
    const error: unknown = await pending.then(() => undefined, (cause: unknown) => cause);
    expect(error).toMatchObject({ code: "OPERATION_FAILED", cause: { workers: [{ ok: false, error: original }] } });
    expect(JSON.stringify(error)).not.toContain("PRIVATE_SIGNAL");
  });
  it("does not use a callback failure or a generic transient status as an implicit retry", async () => {
    const f = setup(), run = vi.fn(() => { throw { status: 429, retryAfter: 0 }; });
    const report = await Execution.preflight([{ ...check("read"), run }], f.options);
    expect(report.status).toBe("incomplete");
    expect(report.checks[0]?.reason).toBe("check-failed");
    expect(run).toHaveBeenCalledOnce();
  });
});
