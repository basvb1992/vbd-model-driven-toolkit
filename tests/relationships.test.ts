import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { Relationships } from "../src/relationships.js";
import type {
  DisassociateOptions, RelationshipConfirmation, RelationshipContext, RelationshipContract,
  RelationshipRequest, RelationshipResult
} from "../src/relationships.js";
import { VbdError } from "../src/errors.js";
import type { EntityRef } from "../src/entity-reference.js";
import type { ReadScope } from "../src/platform.js";
import { deferredData, id, otherId, ref } from "./data-fixture.js";

afterEach(() => vi.unstubAllGlobals());
const target = { entityType: "contact", id: otherId };
function targets(count: number) {
  return Array.from({ length: count }, (_, n) => ({
    entityType: "contact", id: `${(n + 10).toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`
  }));
}
function fixture() {
  const scope: ReadScope = {
    environmentUrl: "https://tenant.example", userId: id, languageId: 1033, online: true
  };
  const relationship: RelationshipContract = {
    scope: { ...scope }, sourceSide: "entity1", cardinality: "collection",
    navigationProperty: "new_account_contact",
    metadata: {
      kind: "manyToMany", SchemaName: "new_account_contact",
      Entity1LogicalName: "account", Entity2LogicalName: "contact",
      Entity1NavigationPropertyName: "new_account_contact",
      Entity2NavigationPropertyName: "new_account_contact",
      IntersectEntityName: "new_account_contact",
      Entity1IntersectAttribute: "accountid", Entity2IntersectAttribute: "contactid"
    }
  };
  const getScope = vi.fn(() => ({ ...scope }));
  const execute = vi.fn<NonNullable<RelationshipContext["executeRelationship"]>>()
    .mockResolvedValue({ ok: true, status: 204 });
  const context: RelationshipContext = { getScope, executeRelationship: execute };
  const confirmation = (requested = [target]): RelationshipConfirmation => ({
    policy: "confirm-disassociate", source: ref, relationship, targets: requested
  });
  return { scope, relationship, context, execute, getScope, confirmation };
}
function associateUnknown(source: unknown, relationship: unknown, refs: unknown, options: unknown): Promise<unknown> {
  const result: unknown = Reflect.apply(Relationships.associate, undefined, [source, relationship, refs, options]);
  return Promise.resolve(result);
}
function removeUnknown(relationship: unknown, options: unknown, refs: unknown = [target]): Promise<unknown> {
  const result: unknown = Reflect.apply(Relationships.disassociate, undefined, [ref, relationship, refs, options]);
  return Promise.resolve(result);
}
function nativeFixture() {
  const host = fixture();
  const utility = {
    getGlobalContext() {
      expect(this).toBe(utility);
      return current;
    }
  };
  const client = {
    getClientState() { expect(this).toBe(client); return host.scope.online ? "Online" : "Offline"; }
  };
  const current = {
    getClientUrl() { expect(this).toBe(current); return host.scope.environmentUrl; },
    userSettings: { userId: id, languageId: 1033 }, client
  };
  const execute = vi.fn(async function(this: unknown, request: RelationshipRequest) {
    expect(this).toBe(online);
    expect(Object.hasOwn(request, "getMetadata")).toBe(false);
    return { ok: true, status: 204 };
  });
  const online = { execute };
  const deleteRecord = vi.fn(), updateRecord = vi.fn(), retrieveMultipleRecords = vi.fn();
  vi.stubGlobal("Xrm", {
    Utility: utility, WebApi: { online, deleteRecord, updateRecord, retrieveMultipleRecords }
  });
  return { ...host, execute, deleteRecord, updateRecord, retrieveMultipleRecords, online };
}

describe("documented many-to-many native CRUD subset", () => {
  it("uses the exact Associate request, prototype metadata, receivers and no record reads/deletes", async () => {
    const host = nativeFixture();
    const result = await Relationships.associate(ref, host.relationship, [target]);
    expect(result).toMatchObject({
      operation: "associate", status: "completed", source: ref,
      relationship: "new_account_contact", navigationProperty: "new_account_contact",
      counts: { requested: 1, attempted: 1, completed: 1, failed: 0, uncertain: 0, skipped: 0 },
      items: [{ target, status: "completed", attempted: true, responseStatus: 204 }]
    });
    const request = host.execute.mock.calls[0]?.[0];
    expect(request).toEqual({ target: ref, relatedEntities: [target], relationship: "new_account_contact" });
    expect(request?.getMetadata()).toEqual({
      boundParameter: null, operationType: 2, operationName: "Associate", parameterTypes: {}
    });
    expect(host.execute).toHaveBeenCalledTimes(1);
    expect(host.deleteRecord).not.toHaveBeenCalled();
    expect(host.updateRecord).not.toHaveBeenCalled();
    expect(host.retrieveMultipleRecords).not.toHaveBeenCalled();
  });
  it("uses exact Disassociate target/relatedEntityId fields, not Delete or lookup clearing", async () => {
    const host = nativeFixture();
    const result = await Relationships.disassociate(ref, host.relationship, [target],
      { confirmation: host.confirmation() });
    expect(result.status).toBe("completed");
    const request = host.execute.mock.calls[0]?.[0];
    expect(request).toEqual({ target: ref, relatedEntityId: target.id, relationship: "new_account_contact" });
    expect(request?.getMetadata()).toEqual({
      boundParameter: null, operationType: 2, operationName: "Disassociate", parameterTypes: {}
    });
    expect(host.deleteRecord).not.toHaveBeenCalled();
    expect(host.updateRecord).not.toHaveBeenCalled();
  });
  it.each(["associate", "disassociate"] as const)("dispatches %s targets sequentially in stable order", async kind => {
    const host = nativeFixture(), requested = targets(3);
    const result = kind === "associate"
      ? await Relationships.associate(ref, host.relationship, requested)
      : await Relationships.disassociate(ref, host.relationship, requested,
        { confirmation: host.confirmation(requested) });
    expect(result.items.map(item => item.target)).toEqual(requested);
    expect(result.counts).toEqual({ requested: 3, attempted: 3, completed: 3, failed: 0, uncertain: 0, skipped: 0 });
    expect(host.execute.mock.calls.map(([request]) => "relatedEntities" in request
      ? request.relatedEntities : [request.relatedEntityId])).toEqual(kind === "associate"
      ? requested.map(value => [value]) : requested.map(value => [value.id]));
  });
  it("does not claim native alias mapping for different schema/navigation names", async () => {
    const host = nativeFixture();
    host.relationship.navigationProperty = "ExactNavigation";
    host.relationship.metadata.Entity1NavigationPropertyName = "ExactNavigation";
    await expect(Relationships.associate(ref, host.relationship, [target]))
      .rejects.toMatchObject({ code: "UNSUPPORTED_SURFACE" });
    expect(host.execute).not.toHaveBeenCalled();
  });
  it("rejects unavailable native execute without trying any other transport", async () => {
    const host = nativeFixture();
    vi.stubGlobal("Xrm", { WebApi: { online: { deleteRecord: host.deleteRecord } } });
    await expect(Relationships.associate(ref, host.relationship, [target]))
      .rejects.toMatchObject({ code: "UNSUPPORTED_SURFACE" });
    expect(host.deleteRecord).not.toHaveBeenCalled();
  });
  it("uses the repository offline scope rejection before any native dispatch", async () => {
    const host = nativeFixture();
    host.scope.online = false;
    await expect(Relationships.associate(ref, host.relationship, [target]))
      .rejects.toMatchObject({ code: "UNSUPPORTED_SURFACE" });
    expect(host.execute).not.toHaveBeenCalled();
  });
});

describe("explicit bounded trusted adapters and contracts", () => {
  it("passes the exact copied contract and expected scope with adapter receiver binding", async () => {
    const host = fixture();
    host.relationship.navigationProperty = "ExactNavigation";
    host.relationship.metadata.Entity1NavigationPropertyName = "ExactNavigation";
    host.execute.mockImplementation(async function(this: unknown, request, scope, contract) {
      expect(this).toBe(host.context);
      expect(scope).toEqual(host.scope);
      expect(contract).toEqual(host.relationship);
      expect(Object.isFrozen(scope)).toBe(true);
      expect(Object.isFrozen(contract.metadata)).toBe(true);
      expect(Object.isFrozen(request.target)).toBe(true);
      expect(Object.isFrozen(request)).toBe(true);
      expect(request.relationship).toBe("new_account_contact");
      return { ok: true, status: 204 };
    });
    expect((await Relationships.associate(ref, host.relationship, [target], { context: host.context })).status)
      .toBe("completed");
  });
  it("supports the explicit reverse source side, without inferring the direction", async () => {
    const host = fixture();
    host.relationship.sourceSide = "entity2";
    const result = await Relationships.associate(target, host.relationship, [ref], { context: host.context });
    expect(result.status).toBe("completed");
    expect(host.execute.mock.calls[0]?.[0]).toMatchObject({ target, relatedEntities: [ref] });
  });
  it("requires the mutation capability, never accepts a generic data execute as an adapter", async () => {
    const host = fixture(), genericExecute = vi.fn();
    for (const context of [
      { getScope: host.getScope }, { getScope: host.getScope, execute: genericExecute }
    ]) {
      await expect(Relationships.associate(ref, host.relationship, [target], { context }))
        .rejects.toMatchObject({ code: "UNSUPPORTED_SURFACE" });
    }
    expect(genericExecute).not.toHaveBeenCalled();
  });
  it("normalizes GUIDs/table names, drops display names and copies all input before the await", async () => {
    const host = fixture(), wait = deferredData();
    const source = { entityType: "ACCOUNT", id: `{${id.toUpperCase()}}`, name: "private name" };
    const requested = [{ entityType: "CONTACT", id: `{${otherId.toUpperCase()}}`, name: "private name" }];
    host.execute.mockReturnValueOnce(wait.promise);
    const pending = Relationships.associate(source, host.relationship, requested, { context: host.context });
    source.id = otherId;
    requested[0] = { entityType: "account", id, name: "changed" };
    host.relationship.metadata.SchemaName = "changed";
    wait.resolve({ ok: true, status: 204 });
    const result = await pending;
    expect(result.source).toEqual(ref);
    expect(result.items[0]?.target).toEqual(target);
    expect(result.relationship).toBe("new_account_contact");
    expect(JSON.stringify(result)).not.toContain("private name");
  });
  it("accepts frozen and foreign-realm JSON contracts without retaining caller objects", async () => {
    const host = fixture();
    const foreign: unknown = runInNewContext(`(${JSON.stringify(host.relationship)})`);
    const result = await associateUnknown(Object.freeze({ ...ref }), foreign,
      Object.freeze([Object.freeze({ ...target })]), { context: host.context });
    expect(result).toMatchObject({ status: "completed" });
  });
  it.each([0, 1, 100, 101])("enforces the actual %i target bound", async count => {
    const host = fixture(), requested = targets(count);
    const pending = Relationships.associate(ref, host.relationship, requested, { context: host.context });
    if (count === 0 || count === 101) {
      await expect(pending).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      expect(host.execute).not.toHaveBeenCalled();
    } else {
      const result = await pending;
      expect(result.counts.completed).toBe(count);
      expect(result.counts.attempted).toBe(count);
      expect(host.execute).toHaveBeenCalledTimes(count);
    }
  });
  it.each(["bad", "", "00000000-0000-0000-0000-000000000000", id.replaceAll("-", ""), `{${id}`])(
    "rejects invalid source and target ID %s before dispatch", async invalid => {
    const host = fixture();
    await expect(Relationships.associate({ ...ref, id: invalid }, host.relationship, [target], { context: host.context }))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(Relationships.associate(ref, host.relationship, [target, { ...target, id: invalid }],
      { context: host.context })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(host.execute).not.toHaveBeenCalled();
  });
  it("rejects duplicate normalized identities instead of silently changing requested counts", async () => {
    const host = fixture();
    await expect(Relationships.associate(ref, host.relationship,
      [target, { entityType: "CONTACT", id: `{${otherId.toUpperCase()}}` }], { context: host.context }))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(host.execute).not.toHaveBeenCalled();
  });
  it.each([
    { cardinality: "single" }, { sourceSide: "guessed" }, { navigationProperty: "Display Label" },
    { navigationProperty: "new_account_contact/$ref" }, { navigationProperty: "WrongNavigation" },
    { cardinality: undefined }, { extra: "unsupported" }
  ])("rejects mismatched cardinality/navigation/extra contract %j", async change => {
    const host = fixture();
    await expect(associateUnknown(ref, { ...host.relationship, ...change }, [target], { context: host.context }))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(host.execute).not.toHaveBeenCalled();
  });
  it.each([
    { kind: "oneToMany" }, { kind: "manyToOne" }, { SchemaName: "" }, { SchemaName: "constructor" },
    { Entity1LogicalName: "contacts" }, { Entity2LogicalName: "ACCOUNT" },
    { Entity1NavigationPropertyName: "WrongNavigation" }, { IntersectEntityName: undefined },
    { Entity2IntersectAttribute: "x/$ref" }
  ])("rejects unsupported/inexact metadata %j before dispatch", async change => {
    const host = fixture();
    await expect(associateUnknown(ref, {
      ...host.relationship, metadata: { ...host.relationship.metadata, ...change }
    }, [target], { context: host.context })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(host.execute).not.toHaveBeenCalled();
  });
  it("rejects foreign source/target types, including a bad last target, before the first dispatch", async () => {
    const host = fixture();
    await expect(Relationships.associate(target, host.relationship, [ref], { context: host.context }))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(Relationships.associate(ref, host.relationship,
      [target, { entityType: "lead", id }], { context: host.context }))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(host.execute).not.toHaveBeenCalled();
  });
  it("rejects accessor, prototype, sparse, symbol and cyclic input before trusted calls", async () => {
    const host = fixture(), getter = vi.fn(() => id);
    const accessor = { entityType: "account", get id() { return getter(); } };
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const sparse = new Array<unknown>(2);
    sparse[0] = target;
    for (const source of [accessor, new Date(), { ...ref, [Symbol("extra")]: 1 }, cycle]) {
      await expect(associateUnknown(source, host.relationship, [target], { context: host.context })).rejects.toBeInstanceOf(VbdError);
    }
    await expect(associateUnknown(ref, host.relationship, sparse, { context: host.context })).rejects.toBeInstanceOf(VbdError);
    expect(getter).not.toHaveBeenCalled();
    expect(host.getScope).not.toHaveBeenCalled();
    expect(host.execute).not.toHaveBeenCalled();
  });
});

describe("deliberate exact relation removal confirmation", () => {
  it.each(["missing", "blanket", "source", "target", "relationship", "navigation", "scope", "order", "extra"])(
    "rejects %s confirmation before dispatch", async change => {
    const host = fixture(), requested = targets(2);
    let confirmation: unknown = host.confirmation(requested);
    if (change === "missing") confirmation = undefined;
    if (change === "blanket") confirmation = { policy: "confirm-disassociate" };
    if (change === "source") confirmation = { ...host.confirmation(requested), source: { ...ref, id: otherId } };
    if (change === "target") confirmation = { ...host.confirmation(requested), targets: [target] };
    if (change === "relationship") confirmation = {
      ...host.confirmation(requested), relationship: { ...host.relationship,
        metadata: { ...host.relationship.metadata, SchemaName: "different" } }
    };
    if (change === "navigation") confirmation = {
      ...host.confirmation(requested), relationship: { ...host.relationship, navigationProperty: "different" }
    };
    if (change === "scope") confirmation = {
      ...host.confirmation(requested), relationship: { ...host.relationship, scope: { ...host.scope, languageId: 1043 } }
    };
    if (change === "order") confirmation = { ...host.confirmation(requested), targets: [...requested].reverse() };
    if (change === "extra") confirmation = { ...host.confirmation(requested), deleteRecords: true };
    await expect(removeUnknown(host.relationship, { context: host.context, confirmation }, requested))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(host.execute).not.toHaveBeenCalled();
  });
  it("normalizes but never mutates exact removal confirmation", async () => {
    const host = fixture();
    const confirmation = host.confirmation();
    confirmation.source = { entityType: "ACCOUNT", id: `{${id}}` };
    confirmation.targets = [{ entityType: "CONTACT", id: `{${otherId}}` }];
    const before = JSON.stringify(confirmation);
    const result = await Relationships.disassociate(ref, host.relationship, [target], { context: host.context, confirmation });
    expect(result.status).toBe("completed");
    expect(JSON.stringify(confirmation)).toBe(before);
  });
});

describe("explicit response/error consequences without retry", () => {
  it.each([
    null, undefined, [], {}, { ok: true }, { ok: true, status: "204" },
    { ok: true, status: 204.5 }, { ok: true, status: 200 }, { ok: true, status: 201 },
    { ok: false, status: 204 }, { ok: true, status: 403 }, { ok: false, status: 99 },
    { ok: false, status: 600 }, { ok: "true", status: 204 }
  ])("treats malformed/unsupported response %j as uncertain", async response => {
    const host = fixture();
    host.execute.mockResolvedValue(response);
    const result = await Relationships.associate(ref, host.relationship, [target], { context: host.context });
    expect(result).toMatchObject({
      status: "uncertain", error: { code: "MUTATION_OUTCOME_UNKNOWN" },
      counts: { attempted: 1, completed: 0, uncertain: 1, failed: 0 },
      items: [{ status: "uncertain", attempted: true }]
    });
    expect(host.execute).toHaveBeenCalledTimes(1);
  });
  it.each([
    [401, "ACCESS_DENIED"], [403, "ACCESS_DENIED"], [404, "RESOURCE_NOT_FOUND"],
    [412, "CONCURRENCY_CONFLICT"], [400, "DATA_WRITE_FAILED"], [429, "DATA_WRITE_FAILED"],
    [408, "MUTATION_OUTCOME_UNKNOWN"], [500, "MUTATION_OUTCOME_UNKNOWN"], [503, "MUTATION_OUTCOME_UNKNOWN"]
  ] as const)("classifies HTTP %i in rejected and resolved responses as %s", async (status, code) => {
    for (const rejects of [true, false]) {
      const host = fixture(), evidence = { ok: false, status, message: "private customer payload" };
      if (rejects) host.execute.mockRejectedValue(evidence);
      else host.execute.mockResolvedValue(evidence);
      const result = await Relationships.disassociate(ref, host.relationship, [target],
        { context: host.context, confirmation: host.confirmation() });
      expect(result.error?.code).toBe(code);
      expect(result.counts.attempted).toBe(1);
      expect(result.items[0]?.status).toBe(code === "MUTATION_OUTCOME_UNKNOWN" ? "uncertain" : "failed");
      expect(result.diagnostic?.cause).toBe(evidence);
      expect(host.execute).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(result)).not.toContain("private customer payload");
      expect(Object.keys(result)).not.toContain("diagnostic");
      expect(Object.keys(result.items[0] ?? {})).not.toContain("diagnostic");
    }
  });
  it.each([new Error("private transport"), { status: "403" }, { status: 503.5 }, { code: "not-found" }])(
    "does not invent authoritative failure from transport rejection %j", async cause => {
    const host = fixture();
    host.execute.mockRejectedValue(cause);
    const result = await Relationships.associate(ref, host.relationship, [target], { context: host.context });
    expect(result.error?.code).toBe("MUTATION_OUTCOME_UNKNOWN");
    expect(result.diagnostic?.cause).toBe(cause);
    expect(host.execute).toHaveBeenCalledTimes(1);
  });
  it("classifies documented SDK denial evidence without dumping messages", async () => {
    const host = fixture();
    host.execute.mockRejectedValue({ errorCode: -2147220960, message: "private" });
    const result = await Relationships.associate(ref, host.relationship, [target], { context: host.context });
    expect(result.error?.code).toBe("ACCESS_DENIED");
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("treats a synchronous adapter transport exception as attempted and uncertain", async () => {
    const host = fixture();
    host.execute.mockImplementation(() => { throw new Error("transport may have already dispatched"); });
    const result = await Relationships.associate(ref, host.relationship, targets(2), { context: host.context });
    expect(result.items.map(item => item.status)).toEqual(["uncertain", "skipped"]);
    expect(result.counts.attempted).toBe(1);
    expect(host.execute).toHaveBeenCalledTimes(1);
  });
  it("does not invoke rejection getters, and retains hostile descriptor errors as uncertainty", async () => {
    const host = fixture(), getter = vi.fn(() => 403);
    host.execute.mockRejectedValue({ get status() { return getter(); } });
    expect((await Relationships.associate(ref, host.relationship, [target], { context: host.context })).error?.code)
      .toBe("MUTATION_OUTCOME_UNKNOWN");
    expect(getter).not.toHaveBeenCalled();
    host.execute.mockRejectedValue(new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("private"); } }));
    expect((await Relationships.associate(ref, host.relationship, [target], { context: host.context })).status)
      .toBe("uncertain");
  });
  it.each(["associate", "disassociate"] as const)("keeps %s completed/failed/skipped evidence without rollback", async kind => {
    const host = fixture(), requested = targets(4);
    host.execute.mockResolvedValueOnce({ ok: true, status: 204 }).mockRejectedValueOnce({ status: 404 });
    const result = kind === "associate"
      ? await Relationships.associate(ref, host.relationship, requested, { context: host.context })
      : await Relationships.disassociate(ref, host.relationship, requested,
        { context: host.context, confirmation: host.confirmation(requested) });
    expect(result.status).toBe("partial");
    expect(result.items.map(item => item.status)).toEqual(["completed", "failed", "skipped", "skipped"]);
    expect(result.items.map(item => item.target)).toEqual(requested);
    expect(result.counts).toEqual({ requested: 4, attempted: 2, completed: 1, failed: 1, uncertain: 0, skipped: 2 });
    expect(result.error?.code).toBe("RESOURCE_NOT_FOUND");
    expect(host.execute).toHaveBeenCalledTimes(2);
  });
  it("preserves partial outcome plus uncertain second mutation and skipped third target", async () => {
    const host = fixture();
    host.execute.mockResolvedValueOnce({ ok: true, status: 204 }).mockRejectedValueOnce(new Error("network"));
    const result = await Relationships.associate(ref, host.relationship, targets(3), { context: host.context });
    expect(result.status).toBe("partial");
    expect(result.counts).toEqual({ requested: 3, attempted: 2, completed: 1, failed: 0, uncertain: 1, skipped: 1 });
    expect(result.items.map(item => item.status)).toEqual(["completed", "uncertain", "skipped"]);
    expect(host.execute).toHaveBeenCalledTimes(2);
  });
  it("keeps the previous success when scope expires between target dispatches", async () => {
    const host = fixture();
    // snapshot, final preflight, before dispatch, after await, after guard, next dispatch
    let reads = 0;
    host.getScope.mockImplementation(() => {
      if (++reads === 6) host.scope.languageId = 1043;
      return { ...host.scope };
    });
    const result = await Relationships.associate(ref, host.relationship, targets(3), { context: host.context });
    expect(result.status).toBe("partial");
    expect(result.error?.code).toBe("CONFIG_EXPIRED");
    expect(result.items.map(item => item.status)).toEqual(["completed", "skipped", "skipped"]);
    expect(result.counts.attempted).toBe(1);
    expect(host.execute).toHaveBeenCalledTimes(1);
  });
});

describe("current online environment/user/language scope around dispatch and validation", () => {
  it.each(["userId", "environmentUrl", "languageId", "online"] as const)(
    "rejects mismatched or offline %s before dispatch", async field => {
    const host = fixture();
    if (field === "userId") host.scope.userId = otherId;
    if (field === "environmentUrl") host.scope.environmentUrl = "https://other.example";
    if (field === "languageId") host.scope.languageId = 1043;
    if (field === "online") host.scope.online = false;
    await expect(Relationships.associate(ref, host.relationship, [target], { context: host.context }))
      .rejects.toMatchObject({ code: field === "online" ? "UNSUPPORTED_SURFACE" : "CONFIG_EXPIRED" });
    expect(host.execute).not.toHaveBeenCalled();
  });
  it("checks again after capability capture and before the first dispatch", async () => {
    const host = fixture();
    host.getScope.mockReturnValueOnce({ ...host.scope }).mockImplementation(() => ({ ...host.scope, languageId: 1043 }));
    await expect(Relationships.associate(ref, host.relationship, [target], { context: host.context }))
      .rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
    expect(host.execute).not.toHaveBeenCalled();
  });
  it.each(["userId", "environmentUrl", "languageId", "online"] as const)(
    "retains uncertainty on %s change after await, including a failed transport", async field => {
    for (const rejects of [true, false]) {
      const host = fixture(), wait = deferredData();
      host.execute.mockReturnValue(wait.promise);
      const pending = Relationships.associate(ref, host.relationship, targets(2), { context: host.context });
      if (field === "userId") host.scope.userId = otherId;
      if (field === "environmentUrl") host.scope.environmentUrl = "https://other.example";
      if (field === "languageId") host.scope.languageId = 1043;
      if (field === "online") host.scope.online = false;
      if (rejects) wait.reject({ status: 403, message: "private" });
      else wait.resolve({ ok: true, status: 204 });
      const result = await pending;
      expect(result.error?.code).toBe("MUTATION_OUTCOME_UNKNOWN");
      expect(result.items.map(item => item.status)).toEqual(["uncertain", "skipped"]);
      expect(result.counts.attempted).toBe(1);
      expect(host.execute).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(result)).not.toContain("private");
    }
  });
  it.each(["success", "denial", "throws"] as const)("guards scope changed inside %s response validation", async outcome => {
    const host = fixture();
    host.execute.mockResolvedValue({
      get ok() {
        host.scope.languageId = 1043;
        if (outcome === "throws") throw new VbdError("ACCESS_DENIED", { operation: "private" });
        return outcome === "success";
      },
      status: outcome === "success" ? 204 : 403
    });
    const result = await Relationships.associate(ref, host.relationship, [target], { context: host.context });
    expect(result.error?.code).toBe("MUTATION_OUTCOME_UNKNOWN");
    expect(result.counts.uncertain).toBe(1);
    expect(host.execute).toHaveBeenCalledTimes(1);
  });
  it("keeps getter validation exceptions uncertain even without scope drift", async () => {
    const host = fixture();
    host.execute.mockResolvedValue({ get ok() { throw new VbdError("ACCESS_DENIED", { operation: "private" }); }, status: 403 });
    expect((await Relationships.associate(ref, host.relationship, [target], { context: host.context })).status)
      .toBe("uncertain");
  });
  it("rejects credentials and foreign endpoint paths in the metadata scope", async () => {
    const host = fixture();
    for (const url of ["https://user:secret@tenant.example", "https://tenant.example/api/data/v9.2", "http://tenant.example"]) {
      const relationship = { ...host.relationship, scope: { ...host.scope, environmentUrl: url } };
      await expect(Relationships.associate(ref, relationship, [target], { context: host.context }))
        .rejects.toMatchObject({ code: "INVALID_URL" });
    }
    expect(host.execute).not.toHaveBeenCalled();
  });
  it("retains response and transport evidence non-enumerably if scope reading itself fails", async () => {
    const host = fixture(), wait = deferredData();
    host.execute.mockReturnValue(wait.promise);
    const pending = Relationships.associate(ref, host.relationship, [target], { context: host.context });
    host.getScope.mockImplementation(() => { throw new Error("private scope"); });
    wait.resolve({ ok: true, status: 204, customer: "private record" });
    const result = await pending;
    expect(result.diagnostic?.code).toBe("MUTATION_OUTCOME_UNKNOWN");
    expect(result.diagnostic?.cause).toBeDefined();
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("exports only two callable methods with concrete bounded signatures", () => {
    expect(Object.keys(Relationships)).toEqual(["associate", "disassociate"]);
    expect(Object.isFrozen(Relationships)).toBe(true);
    expectTypeOf(Relationships.associate).returns.toEqualTypeOf<Promise<RelationshipResult>>();
    expectTypeOf(Relationships.disassociate).parameters.toEqualTypeOf<
      [source: EntityRef, relationship: RelationshipContract, targets: readonly EntityRef[], options: DisassociateOptions]
    >();
  });
});
