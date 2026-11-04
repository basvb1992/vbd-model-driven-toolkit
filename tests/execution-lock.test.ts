import { afterEach, describe, expect, it, vi } from "vitest";
import { Execution } from "../src/execution.js";
import { Environment } from "../src/environment.js";
import { VbdError } from "../src/errors.js";
import { deferred, launchFixture, appId } from "./environment-helpers.js";

const key = () => ({ namespace: `lock-${crypto.randomUUID()}`, key: "run" });
afterEach(() => vi.unstubAllGlobals());
describe("bounded page-local scoped operation locks", () => {
  it("uses supported current-user scope without calling the default native read method", async () => {
    const fixture = launchFixture(), retrieveMultipleRecords = vi.fn();
    vi.stubGlobal("Xrm", {
      Utility: { getGlobalContext: () => ({
        getClientUrl: () => fixture.scope.environmentUrl,
        userSettings: { userId: fixture.scope.userId, languageId: fixture.scope.languageId },
        client: { getClientState: () => "Online" }
      }) },
      WebApi: { retrieveMultipleRecords }
    });
    await expect(Execution.withLock(key(), () => 0)).resolves.toEqual({ status: "completed", value: 0 });
    expect(retrieveMultipleRecords).not.toHaveBeenCalled();
  });
  it("rejects unavailable/offline scope without dispatching callbacks", async () => {
    const fixture = launchFixture(), callback = vi.fn();
    fixture.scope.online = false;
    await expect(Execution.withLock(key(), callback, { context: fixture.context })).rejects.toMatchObject({ code: "UNSUPPORTED_SURFACE" });
    vi.stubGlobal("Xrm", undefined);
    await expect(Execution.withLock(key(), callback)).rejects.toMatchObject({ code: "UNSUPPORTED_SURFACE" });
    expect(callback).not.toHaveBeenCalled();
  });
  it.each([false, 0, "", null, undefined])("preserves callback result %s and performs no reads", async value => {
    const context = launchFixture(), operation = vi.fn(() => value);
    expect(await Execution.withLock(key(), operation, { context: context.context })).toEqual({ status: "completed", value });
    expect(operation).toHaveBeenCalledOnce();
    expect(context.retrieve).not.toHaveBeenCalled();
  });
  it("reserves before a synchronous or asynchronous callback can run", async () => {
    const fixture = launchFixture(), identity = key(), gate = deferred(), callback = vi.fn(async () => { await gate.promise; return "first"; });
    const first = Execution.withLock(identity, callback, { context: fixture.context });
    expect(callback).not.toHaveBeenCalled();
    const duplicate = vi.fn(() => "second");
    await expect(Execution.withLock(identity, duplicate, { context: fixture.context })).rejects.toMatchObject({ code: "RESOURCE_BUSY" });
    await expect(Execution.withLock(identity, duplicate, {
      context: fixture.context, duplicate: "return-busy"
    })).resolves.toEqual({ status: "busy" });
    expect(duplicate).not.toHaveBeenCalled();
    gate.release();
    expect(await first).toEqual({ status: "completed", value: "first" });
    expect(await Execution.withLock(identity, duplicate, { context: fixture.context })).toMatchObject({ status: "completed", value: "second" });
  });
  it("rejects reentrant work instead of waiting for itself", async () => {
    const fixture = launchFixture(), identity = key();
    const result = await Execution.withLock(identity, async () => {
      await expect(Execution.withLock(identity, () => undefined, {
        context: fixture.context
      })).rejects.toMatchObject({ code: "RESOURCE_BUSY" });
      return Execution.withLock(identity, () => undefined, {
        context: fixture.context, duplicate: "return-busy"
      });
    }, { context: fixture.context });
    expect(result).toEqual({ status: "completed", value: { status: "busy" } });
  });
  it("normalizes record identity but excludes the display name from the lock key", async () => {
    const fixture = launchFixture(), identity = key(), gate = deferred();
    const first = Execution.withLock({
      ...identity, record: { entityType: "ACCOUNT", id: `{${appId.toUpperCase()}}`, name: "First" }
    }, () => gate.promise, { context: fixture.context });
    await expect(Execution.withLock({
      ...identity, record: { entityType: "account", id: appId, name: "Other label" }
    }, () => "not run", { context: fixture.context })).rejects.toMatchObject({ code: "RESOURCE_BUSY" });
    expect(await Execution.withLock({
      ...identity, record: { entityType: "contact", id: appId }
    }, () => "different table", { context: fixture.context })).toMatchObject({ value: "different table" });
    gate.release(); await first;
  });
  it.each(["environment", "user", "language", "namespace", "record"] as const)(
    "keeps different %s identities independent", async difference => {
      const fixture = launchFixture(), other = launchFixture(), identity = key(), gate = deferred();
      Object.assign(other.scope, fixture.scope);
      if (difference === "environment") other.scope.environmentUrl = "https://other.example";
      if (difference === "user") other.scope.userId = crypto.randomUUID();
      if (difference === "language") other.scope.languageId = 1043;
      const secondKey = { ...identity, ...(difference === "namespace" ? { namespace: `${identity.namespace}-other` } : {}),
        ...(difference === "record" ? { record: { entityType: "account", id: appId } } : {}) };
      const first = Execution.withLock(identity, () => gate.promise, { context: fixture.context });
      await expect(Execution.withLock(secondKey, () => "independent", { context: other.context }))
        .resolves.toMatchObject({ status: "completed", value: "independent" });
      gate.release(); await first;
    });
  it("shares the same logical scope across distinct typed adapter objects", async () => {
    const fixture = launchFixture(), other = launchFixture(), identity = key(), gate = deferred();
    Object.assign(other.scope, fixture.scope);
    const first = Execution.withLock(identity, () => gate.promise, { context: fixture.context });
    await expect(Execution.withLock(identity, () => undefined, { context: other.context })).rejects.toMatchObject({ code: "RESOURCE_BUSY" });
    gate.release(); await first;
  });
  it("keeps operation-key casing explicit rather than folding unrelated commands", async () => {
    const fixture = launchFixture(), identity = key(), gate = deferred();
    const first = Execution.withLock(identity, () => gate.promise, { context: fixture.context });
    await expect(Execution.withLock({ ...identity, key: "Run" }, () => "independent", {
      context: fixture.context
    })).resolves.toMatchObject({ value: "independent" });
    gate.release(); await first;
  });
  it.each(["scope", "generation"] as const)("rejects %s changes before callback dispatch", async change => {
    const fixture = launchFixture(), identity = key(), callback = vi.fn();
    const pending = Execution.withLock(identity, callback, { context: fixture.context });
    if (change === "scope") fixture.scope.languageId = 1043;
    else Environment.invalidate(undefined, { context: fixture.context });
    await expect(pending).rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
    expect(callback).not.toHaveBeenCalled();
    await expect(Execution.withLock(identity, () => true, { context: fixture.context })).resolves.toMatchObject({ value: true });
  });
  it("retains a pending reservation after scope change and cannot release a newer distinct-scope lock", async () => {
    const fixture = launchFixture(), identity = key(), oldGate = deferred(), newGate = deferred();
    const old = Execution.withLock(identity, () => oldGate.promise, { context: fixture.context });
    await Promise.resolve();
    fixture.scope.languageId = 1043;
    const newer = Execution.withLock(identity, () => newGate.promise, { context: fixture.context });
    await Promise.resolve();
    oldGate.release();
    await expect(old).rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
    await expect(Execution.withLock(identity, () => "duplicate", { context: fixture.context })).rejects.toMatchObject({ code: "RESOURCE_BUSY" });
    newGate.release();
    await expect(newer).resolves.toMatchObject({ status: "completed" });
  });
  it("does not expire or replace an in-flight lock on environment invalidation", async () => {
    const fixture = launchFixture(), identity = key(), gate = deferred();
    const old = Execution.withLock(identity, () => gate.promise, { context: fixture.context });
    await Promise.resolve();
    Environment.invalidate(undefined, { context: fixture.context });
    await expect(Execution.withLock(identity, () => "unsafe retry", { context: fixture.context })).rejects.toMatchObject({ code: "RESOURCE_BUSY" });
    gate.release();
    await expect(old).rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
    await expect(Execution.withLock(identity, () => "explicit next operation", { context: fixture.context })).resolves.toMatchObject({ value: "explicit next operation" });
  });
  it("preserves structured callback errors and normalizes unknown errors without leaking them", async () => {
    const fixture = launchFixture(), identity = key(), native = new Error("PRIVATE_CANARY"), structured = new VbdError("PARTIAL_FAILURE", { operation: "test.partial", cause: native });
    await expect(Execution.withLock(identity, () => { throw structured; }, { context: fixture.context })).rejects.toBe(structured);
    await expect(Execution.withLock(identity, async () => { throw native; }, { context: fixture.context })).rejects.toMatchObject({
      code: "OPERATION_FAILED", cause: native
    });
    try { await Execution.withLock(identity, () => { throw native; }, { context: fixture.context }); }
    catch (error) { expect(String(error)).not.toContain("PRIVATE_CANARY"); }
    expect(await Execution.withLock(identity, () => "released", { context: fixture.context })).toMatchObject({ value: "released" });
  });
  it("retains both callback and stale-scope failure evidence", async () => {
    const fixture = launchFixture(), identity = key(), cause = new Error("operation failed");
    await expect(Execution.withLock(identity, () => {
      fixture.scope.languageId = 1043; throw cause;
    }, { context: fixture.context })).rejects.toMatchObject({
      code: "CONFIG_EXPIRED", cause: { operation: cause }
    });
  });
  it.each([
    { namespace: "" }, { key: "x".repeat(129) }, { record: { entityType: "account", id: "invalid" } },
    { unrelated: true }
  ])("rejects invalid key before invoking work", async change => {
    const callback = vi.fn(), fixture = launchFixture();
    await expect(Reflect.apply(Execution.withLock, undefined, [
      { ...key(), ...change }, callback, { context: fixture.context }
    ])).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(callback).not.toHaveBeenCalled();
  });
  it.each([{ duplicate: "wait" }, { ttlMs: 1 }, { duplicate: null }])("rejects unsupported options", async extra => {
    const callback = vi.fn(), fixture = launchFixture();
    await expect(Reflect.apply(Execution.withLock, undefined, [
      key(), callback, { context: fixture.context, ...extra }
    ])).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(callback).not.toHaveBeenCalled();
  });
  it("accepts exact identifier bounds and rejects a non-callable operation", async () => {
    const fixture = launchFixture(), identity = { namespace: "x".repeat(128), key: "y".repeat(128) };
    expect(await Execution.withLock(identity, () => 1, { context: fixture.context })).toMatchObject({ value: 1 });
    await expect(Reflect.apply(Execution.withLock, undefined, [identity, "not code", { context: fixture.context }]))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });
  it("bounds active locks at 128 without queuing or evicting an in-flight callback", async () => {
    const fixture = launchFixture(), namespace = `capacity-${crypto.randomUUID()}`, gate = deferred();
    const pending = Array.from({ length: 128 }, (_, index) =>
      Execution.withLock({ namespace, key: `entry-${index}` }, () => gate.promise, { context: fixture.context }));
    try {
      await expect(Execution.withLock({ namespace, key: "over" }, () => true, { context: fixture.context })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
      await expect(Execution.withLock({ namespace, key: "entry-0" }, () => true, {
        context: fixture.context, duplicate: "return-busy"
      })).resolves.toEqual({ status: "busy" });
    } finally { gate.release(); await Promise.all(pending); }
    await expect(Execution.withLock({ namespace, key: "over" }, () => true, { context: fixture.context })).resolves.toMatchObject({ value: true });
  });
});
