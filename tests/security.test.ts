import { afterEach, describe, expect, it, vi } from "vitest";
import { Diagnostics } from "../src/diagnostics.js";
import { VbdError } from "../src/errors.js";
import { Security } from "../src/security.js";
import { isRecord } from "../src/validation.js";
import type {
  PrivilegeDepth, SecurityContext, SecurityDepthEncoding, SecurityPrivilegeRead, SecurityScope,
  SecurityTableRead, TableOperation
} from "../src/security.js";

const userId = "11111111-2222-3333-4444-555555555555";
const privilegeId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const otherId = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";
const businessUnitId = "cccccccc-dddd-eeee-ffff-000000000000";
function entry(depth: string | number = "global", id = privilegeId, name = "prvReadAccount") {
  return { id, privilegeName: name, businessUnitId, depth };
}
function tablePrivilege(type = 2, id = privilegeId, name = "prvReadAccount") {
  return {
    PrivilegeId: id, Name: name, PrivilegeType: type,
    CanBeBasic: true, CanBeLocal: true, CanBeDeep: true, CanBeGlobal: true,
    CanBeEntityReference: false, CanBeParentEntityReference: false
  };
}
function fixture() {
  let scope: SecurityScope = { environmentUrl: "https://org.example", userId, languageId: 1033, online: true };
  let privileges: unknown = { [privilegeId]: entry() };
  let metadata: unknown = { LogicalName: "account", Privileges: [tablePrivilege()] };
  let complete = true, tableComplete = true;
  let depthEncoding: SecurityDepthEncoding = "semantic";
  const getScope = vi.fn(() => ({ ...scope }));
  const privilegeRead = vi.fn(async (): Promise<SecurityPrivilegeRead> =>
    ({ scope: { ...scope }, complete, depthEncoding, privileges }));
  const tableRead = vi.fn(async (table: string): Promise<SecurityTableRead> => {
    expect(table).toBe("account");
    return { scope: { ...scope }, complete: tableComplete, metadata };
  });
  const context: SecurityContext = {
    getScope, getSecurityRolePrivilegesInfo: privilegeRead, getEntityMetadata: tableRead
  };
  return {
    context, getScope, privilegeRead, tableRead,
    setScope: (value: Partial<SecurityScope>) => { scope = { ...scope, ...value }; },
    scope: () => ({ ...scope }),
    setPrivileges: (value: unknown) => { privileges = value; },
    setMetadata: (value: unknown) => { metadata = value; },
    setComplete: (value: boolean) => { complete = value; },
    setTableComplete: (value: boolean) => { tableComplete = value; },
    setEncoding: (value: SecurityDepthEncoding) => { depthEncoding = value; }
  };
}
function nativeFixture() {
  const f = fixture();
  const privileges = vi.fn(async (): Promise<unknown> => ({ [privilegeId]: entry(3) }));
  const metadata = vi.fn(async (): Promise<unknown> => ({ LogicalName: "account", Privileges: [tablePrivilege()] }));
  const settings = { userId, languageId: 1033, getSecurityRolePrivilegesInfo: privileges };
  const current = {
    userSettings: settings, getClientUrl: () => f.scope().environmentUrl,
    client: { getClientState: () => "Online" }
  };
  const utility = { getGlobalContext: vi.fn(() => current), getEntityMetadata: metadata };
  vi.stubGlobal("Xrm", { Utility: utility });
  return { ...f, current, settings, utility, privileges, metadata };
}
afterEach(() => vi.unstubAllGlobals());

describe("Security.hasPrivilege", () => {
  it("exports exactly the two owned catalog APIs", () => {
    expect(Object.keys(Security).sort()).toEqual(["assessTable", "hasPrivilege"]);
    expect(Object.isFrozen(Security)).toBe(true);
  });
  it.each([{ id: privilegeId }, { name: "prvReadAccount" }, { id: `{${privilegeId.toUpperCase()}}` }])(
    "allows a complete supported dictionary by stable identity %j", async identity => {
      const f = fixture();
      const result = await Security.hasPrivilege(identity, { context: f.context, requiredDepth: "global" });
      expect(result).toMatchObject({ state: "allowed", reason: "depth-sufficient", grantedDepth: "global" });
      expect(result.scope).toEqual({
        basis: "current-user-table-privileges", source: "adapter", observation: "current",
        environment: "redacted", user: "redacted", languageId: 1033
      });
    });
  it("distinguishes complete absence from incomplete metadata", async () => {
    const f = fixture(); f.setPrivileges({});
    expect(await Security.hasPrivilege({ id: privilegeId }, { context: f.context }))
      .toMatchObject({ state: "denied", reason: "privilege-absent" });
    f.setComplete(false);
    expect(await Security.hasPrivilege({ id: privilegeId }, { context: f.context }))
      .toMatchObject({ state: "unknown", reason: "incomplete-privileges" });
  });
  const depths: PrivilegeDepth[] = ["basic", "local", "deep", "global"];
  const encodings: { encoding: SecurityDepthEncoding; values: (number | string)[] }[] = [
    { encoding: "semantic", values: depths },
    { encoding: "sdk-enum", values: [0, 1, 2, 3] },
    { encoding: "privilege-mask", values: [1, 2, 4, 8] }
  ];
  for (const { encoding, values } of encodings) {
    for (const [index, raw] of values.entries()) {
      it.each(depths)(`${encoding} ${raw} has exact minimum threshold %s`, async requiredDepth => {
        const f = fixture(); f.setEncoding(encoding); f.setPrivileges({ [privilegeId]: entry(raw) });
        const result = await Security.hasPrivilege({ id: privilegeId }, { context: f.context, requiredDepth });
        expect(result.state).toBe(index >= depths.indexOf(requiredDepth) ? "allowed" : "denied");
        expect(result.grantedDepth).toBe(depths[index]);
        expect(result.reason).toBe(result.state === "allowed" ? "depth-sufficient" : "depth-insufficient");
      });
    }
  }
  it.each([
    ["sdk-enum", 4], ["sdk-enum", 8], ["sdk-enum", "3"], ["privilege-mask", 0],
    ["privilege-mask", 3], ["privilege-mask", 5], ["semantic", "Global"], ["semantic", 3]
  ] satisfies [SecurityDepthEncoding, number | string][])("does not guess %s depth %s", async (encoding, raw) => {
    const f = fixture(); f.setEncoding(encoding); f.setPrivileges({ [privilegeId]: entry(raw) });
    expect(await Security.hasPrivilege({ id: privilegeId }, { context: f.context }))
      .toMatchObject({ state: "unknown", reason: "unsupported-depth" });
  });
  it.each([
    null, [], { entities: [] }, { [privilegeId]: null },
    { [privilegeId]: { id: privilegeId } },
    { [privilegeId]: { ...entry(), id: otherId } },
    { [privilegeId]: { ...entry(), businessUnitId: "not-a-guid" } },
    { [privilegeId]: { ...entry(), privilegeName: "System Administrator" } },
    { [privilegeId]: { ...entry(), depth: null } },
    { [privilegeId]: { ...entry(), depth: -1 } },
    { [privilegeId]: { ...entry(), depth: 1.5 } },
    { [privilegeId]: { ...entry(), depth: Number.NaN } }
  ])("returns unknown for malformed dictionaries, never complete absence: %j", async privileges => {
    const f = fixture(); f.setPrivileges(privileges);
    expect(await Security.hasPrivilege({ name: "prvWriteAccount" }, { context: f.context }))
      .toMatchObject({ state: "unknown", reason: "invalid-response" });
  });
  it("validates the whole dictionary, not only a matching entry", async () => {
    const f = fixture(); f.setPrivileges({ [privilegeId]: entry(), [otherId]: { bad: true } });
    expect((await Security.hasPrivilege({ id: privilegeId }, { context: f.context })).state).toBe("unknown");
  });
  it.each([
    { [privilegeId]: entry(), [`{${privilegeId.toUpperCase()}}`]: entry() },
    { [privilegeId]: entry(), [otherId]: entry("basic", otherId) }
  ])("never takes a maximum or first duplicate: %j", async privileges => {
    const f = fixture(); f.setPrivileges(privileges);
    expect(await Security.hasPrivilege({ id: privilegeId }, { context: f.context }))
      .toMatchObject({ state: "unknown", reason: "ambiguous-privileges" });
  });
  it("does not cache permission results or failed reads", async () => {
    const f = fixture();
    f.privilegeRead.mockRejectedValueOnce(new Error("transient"));
    expect((await Security.hasPrivilege({ id: privilegeId }, { context: f.context })).state).toBe("unknown");
    expect((await Security.hasPrivilege({ id: privilegeId }, { context: f.context })).state).toBe("allowed");
    f.setPrivileges({});
    expect((await Security.hasPrivilege({ id: privilegeId }, { context: f.context })).state).toBe("denied");
    expect(f.privilegeRead).toHaveBeenCalledTimes(3);
  });
  it.each([401, 403, 500])("retains rejected read causes without serializing them: %s", async status => {
    const f = fixture(), cause = { status, message: `sensitive ${userId} ${businessUnitId}` };
    f.privilegeRead.mockRejectedValue(cause);
    const result = await Security.hasPrivilege({ id: privilegeId }, { context: f.context });
    expect(result).toMatchObject({ state: "unknown", reason: status === 500 ? "read-failed" : "read-denied" });
    const error = result.diagnostic;
    expect(error).toBeInstanceOf(VbdError);
    expect(error?.cause === cause || (error?.cause instanceof VbdError && error.cause.cause === cause)).toBe(true);
    const serialized = JSON.stringify(result);
    for (const sensitive of [userId, privilegeId, businessUnitId, "sensitive", "org.example", "diagnostic"]) {
      expect(serialized).not.toContain(sensitive);
    }
    const sink = vi.fn();
    await Diagnostics.report(error, { operation: "security.read", sink });
    expect(JSON.stringify(sink.mock.calls)).not.toContain("sensitive");
    expect(serialized.length).toBeLessThan(400);
  });
  it("recognizes the supported privilege-read denial error code", async () => {
    const f = fixture(); f.privilegeRead.mockRejectedValue({ errorCode: -2147220960 });
    expect((await Security.hasPrivilege({ id: privilegeId }, { context: f.context })).reason).toBe("read-denied");
  });
  it("does not turn a missing read method into a deny", async () => {
    const f = fixture();
    expect(await Security.hasPrivilege({ id: privilegeId }, { context: { getScope: f.context.getScope } }))
      .toMatchObject({ state: "unknown", reason: "api-unavailable" });
  });
  it("contains accessor failures, preserving their cause", async () => {
    const f = fixture(), cause = new Error("sensitive getter");
    f.setPrivileges({ get [privilegeId]() { throw cause; } });
    const result = await Security.hasPrivilege({ id: privilegeId }, { context: f.context });
    expect(result.state).toBe("unknown"); expect(result.diagnostic?.cause).toBe(cause);
  });
  it.each([
    Object.defineProperty({}, privilegeId, { value: entry(), enumerable: false }),
    { [Symbol("partial")]: entry() },
    new Map([[privilegeId, entry()]]),
    { [privilegeId]: Object.assign(new (class {})(), entry()) }
  ])("does not mistake exotic dictionary data for complete absence: %j", async privileges => {
    const f = fixture(); f.setPrivileges(privileges);
    expect((await Security.hasPrivilege({ id: privilegeId }, { context: f.context })).reason).toBe("invalid-response");
  });
  it.each([
    null, {}, { complete: true, privileges: {} },
    { scope: {}, complete: true, depthEncoding: "semantic", privileges: {} },
    { complete: "true", depthEncoding: "semantic", privileges: {} },
    { complete: true, depthEncoding: "guessed", privileges: {} },
    { complete: true, depthEncoding: "semantic", privileges: {}, nextLink: "more" }
  ])("does not accept unavailable/partial/paged adapter envelopes: %j", async payload => {
    const f = fixture();
    const context = {
      getScope: f.context.getScope,
      getSecurityRolePrivilegesInfo: async () => isRecord(payload) ? { scope: f.scope(), ...payload } : payload
    };
    const result = await Reflect.apply(Security.hasPrivilege, undefined, [{ id: privilegeId }, { context }]);
    expect(result).toMatchObject({ state: "unknown", reason: "invalid-response" });
  });
  it("never invokes arbitrary adapter operations", async () => {
    const f = fixture(), execute = vi.fn(() => { throw new Error("must not run"); });
    const context = { ...f.context, execute };
    expect((await Security.hasPrivilege({ id: privilegeId }, { context })).state).toBe("allowed");
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("Security native supported APIs", () => {
  it.each([0, 1, 2, 3, 4, 8, "3", "global"])("does not assume native depth encoding for %s", async depth => {
    const f = nativeFixture(); f.privileges.mockResolvedValue({ [privilegeId]: entry(depth) });
    expect(await Security.hasPrivilege({ id: privilegeId }))
      .toMatchObject({ state: "unknown", reason: "unverified-depth", scope: { source: "xrm" } });
    expect(f.privileges).toHaveBeenCalledWith();
  });
  it("can deny absence in the documented complete native dictionary", async () => {
    const f = nativeFixture(); f.privileges.mockResolvedValue({});
    expect((await Security.hasPrivilege({ name: "prvReadAccount" })).reason).toBe("privilege-absent");
  });
  it("maps native table metadata without inferring access from its existence", async () => {
    const f = nativeFixture();
    expect((await Security.assessTable("account", "read")).reason).toBe("unverified-depth");
    expect(f.metadata).toHaveBeenCalledWith("account", []);
  });
  it("returns explicit scope-unavailable with no Xrm", async () => {
    vi.stubGlobal("Xrm", undefined);
    expect(await Security.hasPrivilege({ id: privilegeId }))
      .toMatchObject({ state: "unknown", reason: "scope-unavailable" });
  });
  it("handles present global context but missing user privilege API", async () => {
    const f = nativeFixture();
    Reflect.deleteProperty(f.settings, "getSecurityRolePrivilegesInfo");
    expect((await Security.hasPrivilege({ id: privilegeId })).reason).toBe("api-unavailable");
  });
  it("does not accept a synchronous fake response as the supported promise API", async () => {
    const f = nativeFixture();
    Reflect.set(f.settings, "getSecurityRolePrivilegesInfo", () => ({}));
    expect((await Security.hasPrivilege({ id: privilegeId })).reason).toBe("invalid-response");
  });
  it("retains native read failures and never treats them as empty dictionaries", async () => {
    const f = nativeFixture(), cause = { status: 403, message: "private" };
    f.privileges.mockRejectedValue(cause);
    const result = await Security.hasPrivilege({ id: privilegeId });
    expect(result.reason).toBe("read-denied"); expect(result.diagnostic?.cause).toBe(cause);
  });
  it("handles absent table metadata APIs without privilege reads", async () => {
    const f = nativeFixture(); Reflect.deleteProperty(f.utility, "getEntityMetadata");
    expect((await Security.assessTable("account", "read")).reason).toBe("api-unavailable");
    expect(f.privileges).not.toHaveBeenCalled();
  });
});

describe("Security.assessTable", () => {
  it.each([
    ["create", 1], ["read", 2], ["write", 3], ["delete", 4],
    ["assign", 5], ["share", 6], ["append", 7], ["appendTo", 8]
  ] satisfies [TableOperation, number][])("maps %s only to documented PrivilegeType %s", async (operation, type) => {
    const f = fixture();
    f.setMetadata({ LogicalName: "account", Privileges: [
      tablePrivilege(0, otherId, "prvOther"), tablePrivilege(type)
    ] });
    expect(await Security.assessTable("Account", operation, { context: f.context, requiredDepth: "global" }))
      .toMatchObject({ state: "allowed", grantedDepth: "global" });
    expect(f.tableRead).toHaveBeenCalledWith("account");
  });
  it("uses the mapped stable ID/name, not a synthesized table privilege name", async () => {
    const f = fixture(); f.setMetadata({ LogicalName: "account", Privileges: [
      tablePrivilege(2, otherId, "prvDifferentStableName")
    ] });
    expect((await Security.assessTable("account", "read", { context: f.context })).reason).toBe("privilege-absent");
  });
  it("delegates exact requested depth to user assessment", async () => {
    const f = fixture(); f.setPrivileges({ [privilegeId]: entry("local") });
    expect(await Security.assessTable("account", "read", { context: f.context, requiredDepth: "deep" }))
      .toMatchObject({ state: "denied", reason: "depth-insufficient", grantedDepth: "local" });
  });
  it.each([
    null, {}, { LogicalName: "contact", Privileges: [tablePrivilege()] },
    { LogicalName: "account" }, { LogicalName: "account", Privileges: null },
    { LogicalName: "account", Privileges: [{ PrivilegeType: 2 }] },
    { LogicalName: "account", Privileges: [{ ...tablePrivilege(), PrivilegeType: 16 }] },
    { LogicalName: "account", Privileges: [{ ...tablePrivilege(), CanBeBasic: "true" }] }
  ])("does not infer rights from malformed or partial metadata: %j", async metadata => {
    const f = fixture(); f.setMetadata(metadata);
    expect(await Security.assessTable("account", "read", { context: f.context }))
      .toMatchObject({ state: "unknown", reason: "invalid-response" });
    expect(f.privilegeRead).not.toHaveBeenCalled();
  });
  it.each([{ privileges: [] }, { privileges: [tablePrivilege(1)] }])(
    "returns unknown for a non-exposed table operation %j", async ({ privileges }) => {
    const f = fixture(); f.setMetadata({ LogicalName: "account", Privileges: privileges });
    expect((await Security.assessTable("account", "read", { context: f.context })).reason).toBe("operation-unavailable");
    expect(f.privilegeRead).not.toHaveBeenCalled();
    });
  it("honors incomplete table reads before inspecting privileges", async () => {
    const f = fixture(); f.setTableComplete(false);
    expect((await Security.assessTable("account", "read", { context: f.context })).reason).toBe("incomplete-table-metadata");
    expect(f.privilegeRead).not.toHaveBeenCalled();
  });
  it("rejects ambiguous table privilege mappings", async () => {
    const f = fixture();
    f.setMetadata({ LogicalName: "account", Privileges: [tablePrivilege(), tablePrivilege(2, otherId, "prvOther")] });
    expect((await Security.assessTable("account", "read", { context: f.context })).reason).toBe("ambiguous-privileges");
  });
  it("rejects an ID/name disagreement between metadata and user dictionaries", async () => {
    const f = fixture(); f.setPrivileges({ [privilegeId]: entry("global", privilegeId, "prvOther") });
    expect((await Security.assessTable("account", "read", { context: f.context })).reason).toBe("ambiguous-privileges");
  });
  it("does not accept a granted depth unsupported by table metadata", async () => {
    const f = fixture();
    f.setMetadata({ LogicalName: "account", Privileges: [{ ...tablePrivilege(), CanBeGlobal: false }] });
    expect((await Security.assessTable("account", "read", { context: f.context })).reason).toBe("invalid-response");
  });
  it("handles denied table metadata reads without querying privileges", async () => {
    const f = fixture(); f.tableRead.mockRejectedValue({ status: 403, message: "private" });
    expect((await Security.assessTable("account", "read", { context: f.context })).reason).toBe("read-denied");
    expect(f.privilegeRead).not.toHaveBeenCalled();
  });
  it("does not infer an operation from an external-party-only privilege", async () => {
    const f = fixture();
    f.setMetadata({ LogicalName: "account", Privileges: [{
      ...tablePrivilege(), CanBeBasic: false, CanBeLocal: false, CanBeDeep: false, CanBeGlobal: false,
      CanBeEntityReference: true
    }] });
    expect((await Security.assessTable("account", "read", { context: f.context })).reason).toBe("operation-unavailable");
  });
  it("never treats duplicate identical table entries as more evidence", async () => {
    const f = fixture(); f.setMetadata({ LogicalName: "account", Privileges: [tablePrivilege(), tablePrivilege()] });
    expect((await Security.assessTable("account", "read", { context: f.context })).reason).toBe("ambiguous-privileges");
  });
});

describe("Security validation and observation races", () => {
  it.each([{}, { id: "bad" }, { name: "System Administrator" }, { name: "" },
    { name: "prvReadAccount", id: privilegeId }, { id: privilegeId, extra: true }])(
    "rejects invalid privilege identities before reads: %j", async identity => {
      const f = fixture();
      await expect(Reflect.apply(Security.hasPrivilege, undefined, [identity, { context: f.context }]))
        .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      expect(f.getScope).not.toHaveBeenCalled();
    });
  it.each([
    ["account", "execute", {}], ["account", "Read", {}], ["account?$select=*", "read", {}],
    ["", "read", {}], ["account", "read", { requiredDepth: 3 }], ["account", "read", { requiredDepth: "organization" }],
    ["account", "read", { cache: true }], ["account", "read", { context: {} }]
  ])("rejects invalid table/operation/options %j %j %j", async (table, operation, options) => {
    await expect(Reflect.apply(Security.assessTable, undefined, [table, operation, options]))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });
  it.each([
    { environmentUrl: "http://org.example" }, { environmentUrl: "https://org.example/path" },
    { userId: "bad" }, { languageId: 0 }, { languageId: 1.5 }, { online: false }
  ])("rejects invalid supplied current scope %j", async scope => {
    const f = fixture(); f.setScope(scope);
    await expect(Security.hasPrivilege({ id: privilegeId }, { context: f.context })).rejects.toBeInstanceOf(VbdError);
    expect(f.privilegeRead).not.toHaveBeenCalled();
  });
  for (const stage of ["table", "privilege"] as const) {
    it.each([
      { userId: otherId }, { environmentUrl: "https://other.example" }, { languageId: 1043 }
    ])(`never succeeds across changed scope during ${stage} read: %j`, async change => {
      const f = fixture();
      if (stage === "table") {
        f.tableRead.mockImplementationOnce(async () => {
          const scope = f.scope(); await Promise.resolve(); f.setScope(change);
          return { scope, complete: true, metadata: { LogicalName: "account", Privileges: [tablePrivilege()] } };
        });
      } else {
        f.privilegeRead.mockImplementationOnce(async () => {
          const scope = f.scope(); await Promise.resolve(); f.setScope(change);
          return { scope, complete: true, depthEncoding: "semantic", privileges: { [privilegeId]: entry() } };
        });
      }
      const result = await Security.assessTable("account", "read", { context: f.context });
      expect(result).toMatchObject({ state: "unknown", reason: "scope-changed", scope: { observation: "changed" } });
      expect(result.diagnostic?.code).toBe("CONFIG_EXPIRED");
      if (stage === "table") expect(f.privilegeRead).not.toHaveBeenCalled();
    });
  }
  it("accepts same-user scope replacement and canonical GUID/origin formatting", async () => {
    const f = fixture();
    f.privilegeRead.mockImplementationOnce(async () => {
      await Promise.resolve();
      f.setScope({ userId: `{${userId.toUpperCase()}}`, environmentUrl: "https://ORG.example/" });
      return { scope: f.scope(), complete: true, depthEncoding: "semantic", privileges: { [privilegeId]: entry() } };
    });
    expect((await Security.hasPrivilege({ id: privilegeId }, { context: f.context })).state).toBe("allowed");
  });
  it("rejects a stale adapter response even if current scope did not change", async () => {
    const f = fixture();
    f.privilegeRead.mockResolvedValueOnce({
      scope: { ...f.scope(), userId: otherId }, complete: true,
      depthEncoding: "semantic", privileges: { [privilegeId]: entry() }
    });
    expect((await Security.hasPrivilege({ id: privilegeId }, { context: f.context })).reason).toBe("scope-changed");
  });
  it("rejects stale table metadata before requesting user privileges", async () => {
    const f = fixture();
    f.tableRead.mockResolvedValueOnce({
      scope: { ...f.scope(), languageId: 1043 }, complete: true,
      metadata: { LogicalName: "account", Privileges: [tablePrivilege()] }
    });
    expect((await Security.assessTable("account", "read", { context: f.context })).reason).toBe("scope-changed");
    expect(f.privilegeRead).not.toHaveBeenCalled();
  });
  it("checks final scope even after a complete absence decision", async () => {
    const f = fixture();
    f.privilegeRead.mockResolvedValueOnce({
      scope: f.scope(), complete: true, depthEncoding: "semantic", privileges: {}
    });
    // Initial, pre-read and post-read observations agree; final observation differs.
    f.getScope.mockReturnValueOnce(f.scope()).mockReturnValueOnce(f.scope()).mockReturnValueOnce(f.scope())
      .mockReturnValue({ ...f.scope(), userId: otherId });
    expect((await Security.hasPrivilege({ id: privilegeId }, { context: f.context })).reason).toBe("scope-changed");
  });
  it("does not treat a lost scope after a read as allowed", async () => {
    const f = fixture();
    f.privilegeRead.mockImplementationOnce(async () => {
      const scope = f.scope(); f.setScope({ online: false });
      return { scope, complete: true, depthEncoding: "semantic", privileges: { [privilegeId]: entry() } };
    });
    expect((await Security.hasPrivilege({ id: privilegeId }, { context: f.context })).reason).toBe("scope-changed");
  });
  it("checks scope even on rejected reads and retains both causes", async () => {
    const f = fixture(), cause = new Error("private read failure");
    f.privilegeRead.mockImplementationOnce(async () => {
      f.setScope({ userId: otherId }); throw cause;
    });
    const result = await Security.hasPrivilege({ id: privilegeId }, { context: f.context });
    expect(result.reason).toBe("scope-changed");
    expect(result.diagnostic?.cause).toMatchObject({ read: expect.any(VbdError), scope: expect.any(VbdError) });
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("detects native same-user language changes during metadata reads", async () => {
    const f = nativeFixture();
    f.metadata.mockImplementationOnce(async () => {
      await Promise.resolve(); f.settings.languageId = 1043;
      return { LogicalName: "account", Privileges: [tablePrivilege()] };
    });
    expect((await Security.assessTable("account", "read")).reason).toBe("scope-changed");
    expect(f.privileges).not.toHaveBeenCalled();
  });
});
