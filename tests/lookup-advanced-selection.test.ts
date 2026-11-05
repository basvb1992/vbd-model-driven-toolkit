import { describe, expect, it, vi } from "vitest";
import { Environment } from "../src/environment.js";
import { VbdError } from "../src/errors.js";
import type { EntityRef } from "../src/entity-reference.js";
import { Lookups } from "../src/lookups.js";
import type { LookupAccessEvidence, LookupSelectionOptions } from "../src/lookups.js";
import type { ReadContext } from "../src/platform.js";

const id = (n = 1) => `20000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;
const ref = (n = 1): EntityRef => ({ entityType: "account", id: id(n), name: `Record ${n}` });
const evidence = (value: EntityRef, status: LookupAccessEvidence["status"] = "granted"): LookupAccessEvidence => ({
  ref: { ...value }, status, basis: "caller-evidence"
});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const scope = { environmentUrl: "https://fixture.crm.dynamics.com", userId: id(90), languageId: 1033, online: true };
  const context: ReadContext = {
    getScope: vi.fn(() => ({ ...scope })),
    retrieveMultipleRecords: vi.fn(async () => { throw new Error("No business fetches permitted."); })
  };
  const options: LookupSelectionOptions = {
    allowedTables: ["account"], cardinality: { min: 0, max: 1 }, empty: "invalid",
    predicate: { mode: "sync", test: vi.fn(() => true) }, access: { policy: "not-checked" }, context
  };
  return { options, context, scope };
}
function unsafe(input: unknown, options: unknown) {
  return Reflect.apply(Lookups.validateSelection, undefined, [input, options]);
}
describe("bounded explicit selection predicates and caller-supplied access evidence", () => {
  it("normalizes exact refs, copies predicates/results, accepts a type predicate without unchecked generics", async () => {
    const h = fixture(), input = [{ ...ref(), id: `{${id().toUpperCase()}}`, entityType: "ACCOUNT" }];
    h.options.predicate = {
      mode: "sync", test(value: unknown): value is EntityRef {
        expect(value).toEqual(ref());
        if (typeof value !== "object" || value === null || !("id" in value)) return false;
        value.id = id(8); // Isolated trusted guard argument, not the canonical result.
        return true;
      }
    };
    const result = await Lookups.validateSelection(input, h.options);
    expect(result).toEqual({
      status: "valid", reason: "validated", basis: "trusted-caller-checks",
      records: [{ ref: ref(), predicate: "passed", access: "not-checked" }]
    });
    result.records[0]!.ref.name = "Mutated result";
    expect(input[0]!.name).toBe("Record 1");
    expect(h.context.retrieveMultipleRecords).not.toHaveBeenCalled();
  });
  it.each([true, false])("preserves explicit predicate %s, never truthiness-coerces it", async accepted => {
    const h = fixture();
    h.options.predicate = { mode: "sync", test: () => accepted };
    expect(await Lookups.validateSelection([ref()], h.options)).toMatchObject({
      status: accepted ? "valid" : "invalid", reason: accepted ? "validated" : "predicate",
      records: [{ predicate: accepted ? "passed" : "failed" }]
    });
  });
  it.each(["valid", "invalid"] as const)("preserves an explicitly %s empty selection without invoking predicates", async empty => {
    const h = fixture(); h.options.empty = empty;
    expect(await Lookups.validateSelection([], h.options)).toMatchObject({ status: empty, reason: "empty", records: [] });
    expect(h.options.predicate.test).not.toHaveBeenCalled();
  });
  it("reports cardinality and exact target validation failures, never passes them to trusted callbacks", async () => {
    const h = fixture();
    expect(await Lookups.validateSelection([ref(), ref(2)], h.options)).toMatchObject({ status: "invalid", reason: "cardinality" });
    h.options.cardinality.min = 1;
    expect(await Lookups.validateSelection([], h.options)).toMatchObject({ status: "invalid", reason: "cardinality" });
    for (const entityType of ["contact", "account_extra"]) {
      expect(await Lookups.validateSelection([{ ...ref(), entityType }], h.options)).toMatchObject({
        status: "invalid", reason: "target", records: [{ predicate: "not-run", access: "not-checked" }]
      });
    }
    expect(h.options.predicate.test).not.toHaveBeenCalled();
  });
  it.each([
    null, {}, false, [null], [{ ...ref(), id: "bad" }], [{ ...ref(), entityType: "bad table" }],
    [{ ...ref(), name: "x".repeat(8193) }], [{ ...ref(), extra: true }], [ref(), ref()],
    [ref(), { ...ref(), entityType: "ACCOUNT", id: `{${id()}}` }],
    Array.from({ length: 101 }, (_, n) => ref(n))
  ].map(input => ({ input })))("rejects malformed, oversized or duplicate selection: %j", async ({ input }) => {
    const h = fixture();
    await expect(unsafe(input, h.options)).rejects.toBeInstanceOf(VbdError);
    expect(h.options.predicate.test).not.toHaveBeenCalled();
  });
  it.each([
    { extra: true }, { allowedTables: [] }, { allowedTables: ["account", "ACCOUNT"] },
    { allowedTables: ["account*"] }, { cardinality: { min: 2, max: 1 } }, { cardinality: { min: -1, max: 1 } },
    { cardinality: { min: 0, max: 101 } }, { cardinality: { min: 0, max: 1, allow: true } },
    { empty: undefined }, { predicate: { mode: "sync", test: "string" } },
    { predicate: { mode: "sync", test: () => true, extra: true } },
    { access: undefined }, { access: { policy: "required" } },
    { access: { policy: "not-checked", extra: true } }, { concurrency: 0 }, { concurrency: 9 }
  ])("rejects unsafe/implicit selection policies: %j", async patch => {
    const h = fixture();
    await expect(unsafe([ref()], { ...h.options, ...patch })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });
  it("rejects accessors before reading input refs", async () => {
    const h = fixture(), getter = vi.fn(() => id());
    const value = { entityType: "account", get id() { return getter(); } };
    await expect(unsafe([value], h.options)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(getter).not.toHaveBeenCalled();
  });
  it("bounds a 100-ref selection and eight concurrent callbacks; each output has its own identity", async () => {
    const h = fixture(), pending = deferred<boolean>();
    let active = 0, maximum = 0;
    h.options.cardinality.max = 100; h.options.concurrency = 8;
    h.options.predicate = { mode: "async", test: async () => {
      maximum = Math.max(maximum, ++active); await pending.promise; active--; return true;
    } };
    const refs = Array.from({ length: 100 }, (_, n) => ref(n));
    const result = Lookups.validateSelection(refs, h.options);
    await Promise.resolve();
    expect(active).toBe(8); pending.resolve(true);
    expect((await result).records).toHaveLength(100);
    expect(maximum).toBe(8);
  });
  it("bounds simultaneous validation runs to eight and does not free capacity before all started callbacks drain", async () => {
    const h = fixture(), pending = deferred<boolean>();
    h.options.predicate = { mode: "async", test: () => pending.promise };
    const runs = Array.from({ length: 8 }, () => Lookups.validateSelection([ref()], h.options));
    await expect(Lookups.validateSelection([ref()], h.options)).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    pending.resolve(true);
    await Promise.all(runs);
    expect((await Lookups.validateSelection([ref()], h.options)).status).toBe("valid");
  });
  it.each(["sync", "async"] as const)("handles explicit %s evidence, keeping unknown separate from invalid", async mode => {
    const h = fixture();
    h.options.access = { policy: "required", mode, check: value => evidence(value, "unknown") };
    h.options.predicate = { mode, test: () => false };
    expect(await Lookups.validateSelection([ref()], h.options)).toMatchObject({
      status: "unknown", reason: "access-unknown", records: [{ predicate: "failed", access: "unknown" }]
    });
    h.options.access = { policy: "required", mode, check: value => evidence(value) };
    expect(await Lookups.validateSelection([ref()], h.options)).toMatchObject({ status: "invalid", reason: "predicate" });
  });
  it("returns granted only as caller evidence, copies evidence arguments and results independently", async () => {
    const h = fixture(), raw = evidence(ref());
    h.options.access = { policy: "required", mode: "async", check: async value => {
      value.name = "Mutated evidence argument";
      return raw;
    } };
    const result = await Lookups.validateSelection([ref()], h.options);
    raw.ref.id = id(20);
    expect(result).toMatchObject({
      status: "valid", basis: "trusted-caller-checks", records: [{ ref: ref(), access: "granted" }]
    });
    expect(h.context.retrieveMultipleRecords).not.toHaveBeenCalled();
  });
  it.each([
    undefined, [], {}, { status: "granted" },
    { ref: ref(), status: "granted" },
    { ...evidence(ref()), status: "readfailed" },
    { ...evidence(ref()), ref: ref(2) },
    { ...evidence(ref()), ref: { ...ref(), entityType: "contact" } },
    { ...evidence(ref()), extra: true },
    [evidence(ref()), evidence(ref())]
  ].map(raw => ({ raw })))("rejects partial, duplicate or wrong evidence: %j", async ({ raw }) => {
    const h = fixture();
    const options = { ...h.options, access: { policy: "required", mode: "async", check: () => raw } };
    await expect(unsafe([ref()], options)).rejects.toBeInstanceOf(VbdError);
  });
  it("rejects a duplicated evidence identity for a second selected ref rather than returning partial success", async () => {
    const h = fixture();
    h.options.cardinality.max = 2;
    h.options.access = { policy: "required", mode: "async", check: () => evidence(ref()) };
    await expect(Lookups.validateSelection([ref(), ref(2)], h.options)).rejects.toMatchObject({ code: "DATA_RESPONSE_INVALID" });
  });
  it("throws ACCESS_DENIED for explicit denial, never invalid/missing or authorized", async () => {
    const h = fixture(), denied = evidence(ref(), "denied");
    h.options.access = { policy: "required", mode: "sync", check: () => denied };
    await expect(Lookups.validateSelection([ref()], h.options)).rejects.toMatchObject({ code: "ACCESS_DENIED", cause: denied });
  });
  it.each(["predicate", "access"] as const)("retains %s errors, SDK VbdError identity and denied/read-failed separation", async target => {
    const h = fixture(), sentinel = new VbdError("OPERATION_FAILED", { operation: "test.caller", cause: { private: "retained" } });
    function set(run: () => never) {
      if (target === "predicate") h.options.predicate = { mode: "async", test: run };
      else h.options.access = { policy: "required", mode: "async", check: run };
    }
    set(() => { throw sentinel; });
    await expect(Lookups.validateSelection([ref()], h.options)).rejects.toBe(sentinel);
    const denied = { status: 403, detail: "caller-only" };
    set(() => { throw denied; });
    await expect(Lookups.validateSelection([ref()], h.options)).rejects.toMatchObject({ code: "ACCESS_DENIED", cause: denied });
    const nativeDenied = { errorCode: -2147220960 };
    set(() => { throw nativeDenied; });
    await expect(Lookups.validateSelection([ref()], h.options)).rejects.toMatchObject({ code: "ACCESS_DENIED", cause: nativeDenied });
    const failed = new Error("service unavailable");
    set(() => { throw failed; });
    await expect(Lookups.validateSelection([ref()], h.options)).rejects.toMatchObject({ code: "DATA_READ_FAILED", cause: failed });
  });
  it.each([undefined, null, 0, 1, "true", {}, []].map(output => ({ output })))(
    "rejects nonboolean async predicate output: %j", async ({ output }) => {
      const h = fixture();
      await expect(unsafe([ref()], { ...h.options, predicate: { mode: "async", test: () => output } }))
        .rejects.toMatchObject({ code: "DATA_RESPONSE_INVALID" });
    }
  );
  it.each(["predicate", "access"] as const)("rejects and observes illegal asynchronous %s in sync mode", async target => {
    const h = fixture(), cause = new Error("Invalid async guard");
    const callback = () => Promise.reject(cause);
    const options = target === "predicate"
      ? { ...h.options, predicate: { mode: "sync", test: callback } }
      : { ...h.options, access: { policy: "required", mode: "sync", check: callback } };
    await expect(unsafe([ref()], options)).rejects.toMatchObject({ code: "CONFIG_VALUE_INVALID" });
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  it.each(["predicate", "access", "sync-guard"] as const)(
    "guards around %s callbacks, retaining original errors together with scope evidence", async target => {
      const h = fixture(), cause = new Error("Original error"), pending = deferred<boolean>();
      if (target === "predicate") h.options.predicate = { mode: "async", test: () => pending.promise };
      if (target === "access") h.options.access = {
        policy: "required", mode: "async", check: async () => { await pending.promise; return evidence(ref()); }
      };
      if (target === "sync-guard") h.options.predicate = {
        mode: "sync", test: () => { h.scope.userId = id(91); throw cause; }
      };
      const run = Lookups.validateSelection([ref()], h.options);
      await Promise.resolve();
      h.scope.userId = id(91);
      pending.reject(cause);
      if (target === "sync-guard") {
        // This promise was not supplied to the synchronous callback.
        void pending.promise.catch(() => undefined);
      }
      const error = await run.catch((error: unknown) => error);
      expect(error).toMatchObject({ code: "CONFIG_EXPIRED", cause: { scope: expect.any(Error), error: expect.anything() } });
    }
  );
  it("invalidates selection checks when Environment generation changes during await", async () => {
    const h = fixture(), pending = deferred<boolean>();
    h.options.predicate = { mode: "async", test: () => pending.promise };
    const run = Lookups.validateSelection([ref()], h.options);
    await Promise.resolve();
    Environment.invalidate(undefined, { context: h.context });
    pending.resolve(true);
    await expect(run).rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
  });
  it("drains started callbacks and does not start later items after failure", async () => {
    const h = fixture(), pending = deferred<boolean>(), cause = new Error("First failed");
    h.options.cardinality.max = 3; h.options.concurrency = 2;
    const test = vi.fn().mockRejectedValueOnce(cause).mockReturnValueOnce(pending.promise);
    h.options.predicate = { mode: "async", test };
    const run = Lookups.validateSelection([ref(), ref(2), ref(3)], h.options);
    let settled = false;
    void run.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(settled).toBe(false); expect(test).toHaveBeenCalledTimes(2);
    pending.resolve(true);
    await expect(run).rejects.toMatchObject({ code: "DATA_READ_FAILED", cause });
    expect(test).toHaveBeenCalledTimes(2);
  });
});
