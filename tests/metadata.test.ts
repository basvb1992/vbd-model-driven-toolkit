import { afterEach, describe, expect, it, vi } from "vitest";
import { Cache } from "../src/cache.js";
import { Environment } from "../src/environment.js";
import { VbdError } from "../src/errors.js";
import { Metadata } from "../src/metadata.js";
import type {
  ColumnMetadata, MetadataChoiceSource, MetadataContext, MetadataRead,
  MetadataRelationship, TableMetadata
} from "../src/metadata.js";
import type { ReadScope } from "../src/platform.js";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const userId = "11111111-1111-4111-8111-111111111111";
function fixture() {
  const scope: ReadScope = {
    environmentUrl: "https://metadata.example.test", userId, languageId: 1033, online: true
  };
  const table: TableMetadata = {
    LogicalName: "account", EntitySetName: "accounts", DisplayName: "",
    Description: "", IsCustomEntity: false, ObjectTypeCode: 0, PrimaryImageAttribute: null
  };
  const column: ColumnMetadata = {
    EntityLogicalName: "account", LogicalName: "name", AttributeType: 14, MaxLength: 0
  };
  const choices: MetadataChoiceSource = {
    EntityLogicalName: "account", LogicalName: "category", AttributeType: 11, kind: "picklist",
    Options: [
      { Value: 0, Labels: [{ LanguageCode: 1033, Label: "" }, { LanguageCode: 1043, Label: "Nul" }] },
      { Value: -1, Labels: [{ LanguageCode: 1033, Label: "Other" }, { LanguageCode: 1043, Label: "Anders" }] }
    ]
  };
  const relations: MetadataRelationship[] = [{
    kind: "oneToMany", SchemaName: "account_contacts", ReferencedEntity: "account",
    ReferencedAttribute: "accountid", ReferencingEntity: "contact", ReferencingAttribute: "parentcustomerid",
    ReferencedEntityNavigationPropertyName: "contact_customer_accounts",
    ReferencingEntityNavigationPropertyName: "parentcustomerid_account"
  }];
  const read = <T>(metadata: T | null): MetadataRead<T> => ({ scope: { ...scope }, complete: true, metadata });
  const getTable = vi.fn(async () => read(table));
  const getColumn = vi.fn(async () => read(column));
  const getChoices = vi.fn(async () => read(choices));
  const getRelationships = vi.fn(async () => read(relations));
  const context: MetadataContext = { getScope: () => ({ ...scope }), getTable, getColumn, getChoices, getRelationships };
  return { scope, table, column, choices, relations, read, context, getTable, getColumn, getChoices, getRelationships };
}
/** Deliberately malformed boundary values for runtime-contract tests. */
function untrusted<T>(value: unknown): T { return value as T; }
function gate<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>(resolve => { release = resolve; });
  return { promise, release };
}
function nativeFixture() {
  const host = fixture();
  const column = {
    EntityLogicalName: "account", LogicalName: "enabled", AttributeType: 0,
    DisplayName: "", DefaultFormValue: false
  };
  const collection = {
    get: vi.fn(function (this: unknown) {
      expect(this).toBe(collection);
      return [column];
    })
  };
  const metadata = { ...host.table, Attributes: collection };
  const utility = {
    getGlobalContext: vi.fn(function (this: unknown) {
      expect(this).toBe(utility);
      return current;
    }),
    getEntityMetadata: vi.fn(async function (this: unknown) {
      expect(this).toBe(utility);
      return metadata;
    })
  };
  const client = {
    getClientState: vi.fn(function (this: unknown) {
      expect(this).toBe(client);
      return host.scope.online ? "Online" : "Offline";
    })
  };
  const current = {
    getClientUrl: vi.fn(function (this: unknown) {
      expect(this).toBe(current);
      return host.scope.environmentUrl;
    }),
    client,
    userSettings: { userId, languageId: 1033 }
  };
  // Deliberately no WebApi: metadata must not require business-record reads.
  vi.stubGlobal("Xrm", { Utility: utility });
  return { ...host, utility, collection, metadata, nativeColumn: column, current };
}

describe("R2 Metadata supported native subset", () => {
  it("exports exactly five frozen operations", () => {
    expect(Object.keys(Metadata)).toEqual(["getTable", "getColumn", "getChoices", "getRelationships", "invalidate"]);
    expect(Object.isFrozen(Metadata)).toBe(true);
  });
  it("selects table identities and requested false/zero/empty/null facts; binds native receivers", async () => {
    const host = nativeFixture();
    expect(await Metadata.getTable("account", {
      properties: ["DisplayName", "Description", "IsCustomEntity", "ObjectTypeCode", "PrimaryImageAttribute"]
    })).toEqual(host.table);
    expect(host.utility.getEntityMetadata).toHaveBeenCalledWith("account", []);
    expect(host.current.getClientUrl).toHaveBeenCalled();
    expect(host.utility.getEntityMetadata).toHaveBeenCalledTimes(1);
    expect(Metadata.invalidate({ table: "account" })).toBe(1);
  });
  it("uses only the requested column and safe base/boolean properties, not collection methods", async () => {
    const host = nativeFixture();
    const output = await Metadata.getColumn("account", "enabled", { properties: ["DisplayName", "DefaultFormValue"] });
    expect(output).toEqual(host.nativeColumn);
    expect(host.utility.getEntityMetadata).toHaveBeenCalledWith("account", ["enabled"]);
    expect(host.collection.get).toHaveBeenCalledOnce();
    expect(output).not.toHaveProperty("get");
    Metadata.invalidate();
  });
  it("supports arrays as native column collections and isolates output copies", async () => {
    const host = nativeFixture();
    host.utility.getEntityMetadata.mockResolvedValue(untrusted({
      ...host.table, Attributes: [host.nativeColumn]
    }));
    const first = await Metadata.getColumn("account", "enabled", { properties: ["DisplayName"] });
    first.DisplayName = "changed";
    host.nativeColumn.DisplayName = "source changed";
    expect((await Metadata.getColumn("account", "enabled", { properties: ["DisplayName"] })).DisplayName).toBe("");
    Metadata.invalidate();
  });
  it("does not claim native choices, relationships, targets or constraints", async () => {
    const host = nativeFixture();
    for (const pending of [
      Metadata.getChoices("account", "category"),
      Metadata.getRelationships("account", { kind: "oneToMany" }),
      Metadata.getColumn("account", "enabled", { properties: ["Targets"] }),
      Metadata.getColumn("account", "enabled", { properties: ["MaxLength"] })
    ]) await expect(pending).rejects.toMatchObject({ code: "UNSUPPORTED_SURFACE" });
    expect(host.utility.getEntityMetadata).not.toHaveBeenCalled();
    Metadata.invalidate();
  });
  it.each(["Xrm", "Utility", "getGlobalContext", "getEntityMetadata"])("rejects unavailable native %s", async missing => {
    const host = nativeFixture();
    if (missing === "Xrm") vi.stubGlobal("Xrm", undefined);
    else if (missing === "Utility") vi.stubGlobal("Xrm", {});
    else Reflect.deleteProperty(host.utility, missing);
    await expect(Metadata.getTable("account")).rejects.toMatchObject({ code: "UNSUPPORTED_SURFACE" });
  });
  it.each([undefined, null, {}, { LogicalName: "account" }, { LogicalName: "contact", EntitySetName: "contacts" }])(
    "rejects malformed or wrong-table native metadata %#", async raw => {
      const host = nativeFixture();
      host.utility.getEntityMetadata.mockResolvedValue(untrusted(raw));
      await expect(Metadata.getTable("account")).rejects.toMatchObject({ code: "DATA_RESPONSE_INVALID" });
    }
  );
  it.each([
    [[], "UNSUPPORTED_SURFACE"],
    [[{}, {}], "CONFIG_AMBIGUOUS"],
    [Array.from({ length: 257 }, () => ({})), "LIMIT_EXCEEDED"],
    [[{ EntityLogicalName: "account", LogicalName: "other", AttributeType: 0 }], "DATA_RESPONSE_INVALID"],
    [[{ EntityLogicalName: "account", LogicalName: "enabled", AttributeType: 21 }], "DATA_RESPONSE_INVALID"]
  ])("rejects absent/ambiguous/oversized/wrong native columns %#", async (items, code) => {
    const host = nativeFixture();
    host.collection.get.mockReturnValue(untrusted(items));
    await expect(Metadata.getColumn("account", "enabled")).rejects.toMatchObject({ code });
  });
  it("never invokes accessors or copies unknown native SDK payloads", async () => {
    const host = nativeFixture(), getter = vi.fn(() => "secret");
    const raw = { ...host.metadata, token: "not for output", getDefaultStatus: () => 1 };
    host.utility.getEntityMetadata.mockResolvedValue(untrusted(raw));
    expect(await Metadata.getTable("account")).toEqual({ LogicalName: "account", EntitySetName: "accounts" });
    Metadata.invalidate();
    Object.defineProperty(raw, "EntitySetName", { get: getter, enumerable: true });
    await expect(Metadata.getTable("account")).rejects.toMatchObject({ code: "DATA_RESPONSE_INVALID" });
    expect(getter).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404, 500])("keeps native status %i distinct, redacted, and uncached", async status => {
    const host = nativeFixture();
    host.utility.getEntityMetadata.mockRejectedValue({ status, token: "raw secret", response: "service dump" });
    for (let attempt = 0; attempt < 2; attempt++) {
      try { await Metadata.getTable("account"); expect.fail("must reject"); }
      catch (error) {
        expect(error).toMatchObject({
          code: status === 401 || status === 403 ? "ACCESS_DENIED" :
            status === 404 ? "RESOURCE_NOT_FOUND" : "DATA_READ_FAILED", cause: undefined
        });
        expect(JSON.stringify(error)).not.toContain("secret");
      }
    }
    expect(host.utility.getEntityMetadata).toHaveBeenCalledTimes(2);
  });
});

describe("metadata input and adapter contracts", () => {
  it.each(["Account", "", "accounts/name", "$metadata", "name eq 1", "x".repeat(129), "__proto__", "constructor"])(
    "rejects logical identifier %s before dispatch", async table => {
      const host = fixture();
      await expect(Metadata.getTable(table, { context: host.context })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      expect(host.getTable).not.toHaveBeenCalled();
    }
  );
  it.each([
    { properties: ["EntitySetName"] }, { properties: ["Privileges"] }, { properties: ["DisplayName", "DisplayName"] },
    { properties: Array.from({ length: 10 }, () => "DisplayName") }, { extra: true }, { properties: "DisplayName" }
  ])("rejects invalid table selections %#", async extra => {
    const host = fixture();
    await expect(Metadata.getTable("account", untrusted({ context: host.context, ...extra })))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(host.getTable).not.toHaveBeenCalled();
  });
  it.each([
    { properties: ["bogus"] }, { properties: ["Targets", "Targets"] },
    { properties: Array.from({ length: 12 }, () => "Targets") }
  ])("rejects invalid column selections %#", async extra => {
    const host = fixture();
    await expect(Metadata.getColumn("account", "name", untrusted({ context: host.context, ...extra })))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(host.getColumn).not.toHaveBeenCalled();
  });
  it("rejects option and inherited capability accessors without invoking them", async () => {
    const getter = vi.fn(() => fixture().context);
    const options = Object.defineProperty({}, "context", { enumerable: true, get: getter });
    await expect(Metadata.getTable("account", options)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    const context: unknown = Object.create(Object.defineProperty({}, "getScope", { get: getter }));
    await expect(Metadata.getTable("account", { context: untrusted(context) }))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(getter).not.toHaveBeenCalled();
  });
  it("binds adapter class methods and never passes the original request arrays", async () => {
    const host = fixture(), properties = ["DisplayName"] as const;
    class Adapter implements MetadataContext {
      getScope() { expect(this).toBe(context); return host.scope; }
      async getTable(table: string, selected: readonly string[]) {
        expect(this).toBe(context);
        expect(table).toBe("account");
        expect(selected).toEqual(properties);
        (selected as string[]).splice(0, 1, "Description");
        return host.read(host.table);
      }
    }
    const context = new Adapter();
    expect(await Metadata.getTable("account", { context, properties })).toEqual({
      LogicalName: "account", EntitySetName: "accounts", DisplayName: ""
    });
    expect(properties).toEqual(["DisplayName"]);
  });
  it("normalizes GUID/origin scope and strips unselected known facts", async () => {
    const host = fixture();
    host.scope.environmentUrl = "https://METADATA.example.test/";
    host.scope.userId = `{${userId.toUpperCase()}}`;
    expect(await Metadata.getTable("account", { context: host.context })).toEqual({
      LogicalName: "account", EntitySetName: "accounts"
    });
  });
  it.each([
    { complete: false }, { complete: undefined }, { metadata: {} }, { metadata: undefined },
    { metadata: { LogicalName: "account", EntitySetName: "accounts", token: "no" } },
    { scope: { environmentUrl: "https://other.example.test", userId, languageId: 1033, online: true } }
  ])("rejects incomplete/malformed/wrong-scope adapter envelopes %#", async override => {
    const host = fixture();
    host.getTable.mockResolvedValue(untrusted({ ...host.read(host.table), ...override }));
    await expect(Metadata.getTable("account", { context: host.context })).rejects.toBeInstanceOf(VbdError);
  });
  it("distinguishes explicit absence, missing requested properties, and unsupported capability", async () => {
    const host = fixture();
    host.getTable.mockResolvedValueOnce(untrusted(host.read(null)));
    await expect(Metadata.getTable("account", { context: host.context })).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    await expect(Metadata.getTable("account", { context: host.context, properties: ["IsActivity"] }))
      .rejects.toMatchObject({ code: "UNSUPPORTED_SURFACE" });
    await expect(Metadata.getTable("account", { context: { getScope: host.context.getScope } }))
      .rejects.toMatchObject({ code: "UNSUPPORTED_SURFACE" });
  });
  it.each([
    { AttributeType: 0, DefaultFormValue: false },
    { AttributeType: 14, MaxLength: 0 },
    { AttributeType: 5, MinValue: 0, MaxValue: 0 },
    { AttributeType: 3, Precision: 0, MinValue: null, MaxValue: null },
    { AttributeType: 6, Targets: ["account", "contact"] },
    { AttributeType: 14, IsValidForRead: false, IsValidForCreate: null, IsValidForUpdate: false }
  ])("preserves valid typed/nullable column facts %#", async facts => {
    const host = fixture();
    const metadata = { EntityLogicalName: "account", LogicalName: "name", ...facts };
    host.getColumn.mockResolvedValue(untrusted(host.read(metadata)));
    const properties = Object.keys(facts).filter(key => key !== "AttributeType");
    expect(await Metadata.getColumn("account", "name", untrusted({ context: host.context, properties }))).toEqual(metadata);
  });
  it.each([
    { AttributeType: 14, Targets: ["account"] },
    { AttributeType: 6, Targets: ["account", "account"] },
    { AttributeType: 6, Targets: [] },
    { AttributeType: 6, Targets: ["Display Label"] },
    { AttributeType: 14, DefaultFormValue: false },
    { AttributeType: 0, MaxLength: 0 },
    { AttributeType: 14, MinValue: 0 },
    { AttributeType: 5, Precision: 0 },
    { AttributeType: 5, MinValue: 1, MaxValue: 0 },
    { AttributeType: 5, MinValue: Infinity },
    { AttributeType: 3, Precision: 11 },
    { AttributeType: 14, IsValidForRead: "false" },
    { AttributeType: 14, MaxLength: -1 },
    { AttributeType: 6, Targets: Array.from({ length: 33 }, (_, i) => `t${i}`) }
  ])("rejects unsupported column/type/constraint combinations %#", async facts => {
    const host = fixture();
    host.getColumn.mockResolvedValue(untrusted(host.read({ EntityLogicalName: "account", LogicalName: "name", ...facts })));
    await expect(Metadata.getColumn("account", "name", { context: host.context }))
      .rejects.toBeInstanceOf(VbdError);
  });
});

describe("exact choice identities and localized label policy", () => {
  it("selects explicit LCID labels without deriving values from labels or dropping zero/empty text", async () => {
    const host = fixture();
    const english = await Metadata.getChoices("account", "category", { context: host.context });
    expect(english).toEqual({
      table: "account", column: "category", kind: "picklist", languageId: 1033,
      choices: [
        { value: 0, label: "", languageId: 1033, isFallback: false },
        { value: -1, label: "Other", languageId: 1033, isFallback: false }
      ]
    });
    const dutch = await Metadata.getChoices("account", "category", { context: host.context, languageId: 1043 });
    expect(dutch.choices[0]).toEqual({ value: 0, label: "Nul", languageId: 1043, isFallback: false });
    expect(host.getChoices).toHaveBeenNthCalledWith(1, "account", "category", 1033);
    expect(host.getChoices).toHaveBeenNthCalledWith(2, "account", "category", 1043);
  });
  it("requires explicit alternate-language fallback and reports the actual LCID per label", async () => {
    const host = fixture();
    await expect(Metadata.getChoices("account", "category", { context: host.context, languageId: 1036 }))
      .rejects.toMatchObject({ code: "UNSUPPORTED_SURFACE" });
    const value = await Metadata.getChoices("account", "category", {
      context: host.context, languageId: 1036, fallbackLanguageId: 1043
    });
    expect(value.choices[0]).toEqual({ value: 0, label: "Nul", languageId: 1043, isFallback: true });
    expect(host.getChoices).toHaveBeenLastCalledWith("account", "category", 1036, 1043);
  });
  it.each([0, -1, 65536, 1.5, NaN, "1033"])("rejects invalid LCID %s", async languageId => {
    const host = fixture();
    await expect(Metadata.getChoices("account", "category", untrusted({ context: host.context, languageId })))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(host.getChoices).not.toHaveBeenCalled();
  });
  it("rejects redundant fallback and invalid columns before dispatch", async () => {
    const host = fixture();
    await expect(Metadata.getChoices("account", "category", {
      context: host.context, fallbackLanguageId: 1033
    })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(Metadata.getChoices("account", "Category", { context: host.context }))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });
  it.each([
    { kind: "boolean", AttributeType: 0 },
    { kind: "picklist", AttributeType: 11 },
    { kind: "multiselect", AttributeType: 17 },
    { kind: "state", AttributeType: 12 },
    { kind: "status", AttributeType: 13 }
  ] as const)("supports adapter-attested choice kind $kind with exact type", async facts => {
    const host = fixture();
    Object.assign(host.choices, facts);
    host.choices.Options[1]!.Value = 1;
    expect((await Metadata.getChoices("account", "category", { context: host.context })).kind).toBe(facts.kind);
  });
  it.each([
    { kind: "boolean", AttributeType: 0 },
    { AttributeType: 14 },
    { EntityLogicalName: "contact" },
    { LogicalName: "other" },
    { Options: [{ Value: 2147483648, Labels: [{ LanguageCode: 1033, Label: "x" }] }] },
    { Options: [{ Value: 0, Labels: [] }] },
    { Options: [{ Value: 0, Labels: [{ LanguageCode: 0, Label: "x" }] }] },
    { Options: [{ Value: 0, Labels: [{ LanguageCode: 1033, Label: "x".repeat(1025) }] }] },
    { Options: [{ Value: 0, Labels: Array.from({ length: 17 }, (_, i) => ({ LanguageCode: 1000 + i, Label: "" })) }] },
    { Options: Array.from({ length: 257 }, (_, i) => ({ Value: i, Labels: [{ LanguageCode: 1033, Label: "" }] })) }
  ])("rejects wrong/partial/oversized choices %#", async override => {
    const host = fixture();
    host.getChoices.mockResolvedValue(untrusted(host.read({ ...host.choices, ...override })));
    await expect(Metadata.getChoices("account", "category", { context: host.context })).rejects.toBeInstanceOf(VbdError);
  });
  it("rejects duplicate values and ambiguous LCIDs but permits identical display labels", async () => {
    const host = fixture();
    host.choices.Options[1]!.Value = 0;
    await expect(Metadata.getChoices("account", "category", { context: host.context }))
      .rejects.toMatchObject({ code: "DATA_RESPONSE_INVALID" });
    host.choices.Options[1]!.Value = 1;
    host.choices.Options[0]!.Labels.push({ LanguageCode: 1033, Label: "conflict" });
    await expect(Metadata.getChoices("account", "category", { context: host.context }))
      .rejects.toMatchObject({ code: "DATA_RESPONSE_INVALID" });
    host.choices.Options[0]!.Labels.pop();
    host.choices.Options[1]!.Labels[0]!.Label = "";
    expect((await Metadata.getChoices("account", "category", { context: host.context })).choices.map(item => item.value))
      .toEqual([0, 1]);
  });
  it("measures 256-option/16-label/1024-character limits at the accepted boundaries", async () => {
    const host = fixture();
    host.choices.Options = Array.from({ length: 256 }, (_, value) => ({
      Value: value, Labels: [{ LanguageCode: 1033, Label: "" }]
    }));
    expect((await Metadata.getChoices("account", "category", { context: host.context })).choices).toHaveLength(256);
    Metadata.invalidate({ context: host.context });
    host.choices.Options = [{
      Value: 0, Labels: Array.from({ length: 16 }, (_, i) => ({ LanguageCode: 1033 + i, Label: "x".repeat(1024) }))
    }];
    expect((await Metadata.getChoices("account", "category", { context: host.context })).choices[0]!.label).toHaveLength(1024);
  });
});

describe("exact relationship and navigation identities", () => {
  it("validates one-to-many schema, both navigations, and referencing column filter", async () => {
    const host = fixture();
    expect(await Metadata.getRelationships("account", {
      context: host.context, kind: "oneToMany", schemaName: "account_contacts", column: "parentcustomerid"
    })).toEqual({ table: "account", kind: "oneToMany", relationships: host.relations });
    expect(host.getRelationships).toHaveBeenCalledWith("account", {
      kind: "oneToMany", schemaName: "account_contacts", column: "parentcustomerid"
    });
  });
  it("validates many-to-one relative to referencing table, preserving case-sensitive schema/navigation", async () => {
    const host = fixture();
    host.relations = [];
    host.getRelationships.mockResolvedValue(host.read([{
      kind: "manyToOne", SchemaName: "Contact_ParentAccount", ReferencedEntity: "account",
      ReferencedAttribute: "accountid", ReferencingEntity: "contact", ReferencingAttribute: "parentcustomerid",
      ReferencedEntityNavigationPropertyName: "Contact_Parents", ReferencingEntityNavigationPropertyName: "ParentAccount"
    }]));
    const value = await Metadata.getRelationships("contact", { context: host.context, kind: "manyToOne" });
    expect(value.relationships[0]!.SchemaName).toBe("Contact_ParentAccount");
  });
  it.each(["account", "contact"])("supports many-to-many from either side (%s), with intersect identity", async table => {
    const host = fixture();
    const metadata: MetadataRelationship = {
      kind: "manyToMany", SchemaName: "Account_Contact", Entity1LogicalName: "account", Entity2LogicalName: "contact",
      Entity1NavigationPropertyName: "Account_Contacts", Entity2NavigationPropertyName: "Contact_Accounts",
      IntersectEntityName: "account_contact", Entity1IntersectAttribute: "accountid", Entity2IntersectAttribute: "contactid"
    };
    host.getRelationships.mockResolvedValue(host.read([metadata]));
    expect((await Metadata.getRelationships(table, { context: host.context, kind: "manyToMany" })).relationships)
      .toEqual([metadata]);
  });
  it.each([
    { kind: "all" }, { kind: "oneToMany", column: "Display Label" },
    { kind: "manyToMany", column: "accountid" }, { kind: "oneToMany", schemaName: "bad/nav" }
  ])("rejects invalid relationship selections %# before dispatch", async selection => {
    const host = fixture();
    await expect(Metadata.getRelationships("account", untrusted({ context: host.context, ...selection })))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(host.getRelationships).not.toHaveBeenCalled();
  });
  it.each([
    { ReferencedEntity: "contact" }, { kind: "manyToOne" },
    { ReferencingAttribute: "" }, { SchemaName: "A display label" },
    { ReferencedEntityNavigationPropertyName: null }, { ReferencingEntityNavigationPropertyName: "bad/name" }
  ])("rejects wrong direction/incomplete/invalid identifiers %#", async override => {
    const host = fixture();
    host.getRelationships.mockResolvedValue(untrusted(host.read([{ ...host.relations[0], ...override }])));
    await expect(Metadata.getRelationships("account", { context: host.context, kind: "oneToMany" }))
      .rejects.toMatchObject({ code: "DATA_RESPONSE_INVALID" });
  });
  it("rejects duplicate relationship identity, filter mismatch and self-reference ambiguity", async () => {
    const host = fixture(), item = host.relations[0]!;
    host.relations.push(item);
    await expect(Metadata.getRelationships("account", { context: host.context, kind: "oneToMany" }))
      .rejects.toMatchObject({ code: "DATA_RESPONSE_INVALID" });
    host.relations.pop();
    await expect(Metadata.getRelationships("account", { context: host.context, kind: "oneToMany", schemaName: "other" }))
      .rejects.toMatchObject({ code: "DATA_RESPONSE_INVALID" });
    await expect(Metadata.getRelationships("account", { context: host.context, kind: "oneToMany", column: "otherid" }))
      .rejects.toMatchObject({ code: "DATA_RESPONSE_INVALID" });
    host.getRelationships.mockResolvedValue(untrusted(host.read([{
      ...item, ReferencingEntity: "account", ReferencingEntityNavigationPropertyName: "same",
      ReferencedEntityNavigationPropertyName: "same"
    }])));
    await expect(Metadata.getRelationships("account", { context: host.context, kind: "oneToMany" }))
      .rejects.toMatchObject({ code: "DATA_RESPONSE_INVALID" });
  });
  it("distinguishes complete empty collections, filtered absence, and incomplete empty reads", async () => {
    const host = fixture();
    host.getRelationships.mockResolvedValue(host.read([]));
    expect((await Metadata.getRelationships("account", { context: host.context, kind: "oneToMany" })).relationships).toEqual([]);
    await expect(Metadata.getRelationships("account", { context: host.context, kind: "oneToMany", schemaName: "missing" }))
      .rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    Metadata.invalidate({ context: host.context });
    host.getRelationships.mockResolvedValue({ ...host.read([]), complete: false });
    await expect(Metadata.getRelationships("account", { context: host.context, kind: "oneToMany" }))
      .rejects.toMatchObject({ code: "UNSUPPORTED_SURFACE" });
  });
  it("measures the accepted 128-relationship boundary and rejects 129", async () => {
    const host = fixture(), item = host.relations[0]!;
    const rows: MetadataRelationship[] = Array.from({ length: 128 }, (_, i) => ({
      ...item, SchemaName: `account_contacts_${i}`, ReferencedEntityNavigationPropertyName: `contacts_${i}`
    }));
    host.getRelationships.mockResolvedValue(host.read(rows));
    expect((await Metadata.getRelationships("account", { context: host.context, kind: "oneToMany" })).relationships).toHaveLength(128);
    Metadata.invalidate({ context: host.context });
    rows.push({ ...item, SchemaName: "over" });
    await expect(Metadata.getRelationships("account", { context: host.context, kind: "oneToMany" })).rejects.toBeInstanceOf(VbdError);
  });
});

describe("safe bounded copies and metadata cache lifecycle", () => {
  it.each([
    new Date(), { x: () => 1 }, { x: undefined }, { x: NaN },
    JSON.parse('{"__proto__":{}}') as unknown,
    JSON.parse('{"constructor":{}}') as unknown,
    JSON.parse('{"prototype":{}}') as unknown
  ])("rejects non-JSON and unsafe metadata %# without raw response causes", async metadata => {
    const host = fixture();
    host.getTable.mockResolvedValue(untrusted(host.read(metadata)));
    await expect(Metadata.getTable("account", { context: host.context }))
      .rejects.toMatchObject({ code: "DATA_RESPONSE_INVALID", cause: undefined });
  });
  it("rejects cycles/accessors/depth/node/byte overflow without invoking getters", async () => {
    const host = fixture(), getter = vi.fn(() => "never");
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    const accessor = Object.defineProperty({}, "LogicalName", { enumerable: true, get: getter });
    let deep: unknown = {};
    for (let i = 0; i < 10; i++) deep = { nested: deep };
    for (const raw of [cycle, accessor, deep, "x".repeat(65_537), Array.from({ length: 10_001 }, () => null)]) {
      host.getTable.mockResolvedValue(untrusted(host.read(raw)));
      await expect(Metadata.getTable("account", { context: host.context })).rejects.toBeInstanceOf(VbdError);
    }
    expect(getter).not.toHaveBeenCalled();
    expect(host.getTable).toHaveBeenCalledTimes(5);
  });
  it("enforces 65,536-byte envelope budget even when field/count limits individually pass", async () => {
    const host = fixture();
    host.choices.Options = Array.from({ length: 80 }, (_, Value) => ({
      Value, Labels: [{ LanguageCode: 1033, Label: "x".repeat(1024) }]
    }));
    await expect(Metadata.getChoices("account", "category", { context: host.context }))
      .rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  });
  it("measures the exact 65,536-byte maximum of envelope/normalized output and rejects one extra byte", async () => {
    const host = fixture();
    host.choices.Options = Array.from({ length: 64 }, (_, Value) => ({
      Value, Labels: [{ LanguageCode: 1033, Label: "" }]
    }));
    const size = () => {
      const output = {
        table: "account", column: "category", kind: "picklist", languageId: 1033,
        choices: host.choices.Options.map(item => ({
          value: item.Value, label: item.Labels[0]!.Label, languageId: 1033, isFallback: false
        }))
      };
      return Math.max(...[host.read(host.choices), output]
        .map(value => new TextEncoder().encode(JSON.stringify(value)).byteLength));
    };
    let remaining = 65_536 - size();
    for (const option of host.choices.Options) {
      const length = Math.min(1024, remaining);
      option.Labels[0]!.Label = "x".repeat(length);
      remaining -= length;
    }
    expect(remaining).toBe(0);
    expect(size()).toBe(65_536);
    expect((await Metadata.getChoices("account", "category", { context: host.context })).choices).toHaveLength(64);
    Metadata.invalidate({ context: host.context });
    host.choices.Options.find(item => item.Labels[0]!.Label.length < 1024)!.Labels[0]!.Label += "x";
    expect(size()).toBe(65_537);
    await expect(Metadata.getChoices("account", "category", { context: host.context }))
      .rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  });
  it("copies nested adapter inputs and outputs, and coalesces concurrent callers", async () => {
    const host = fixture(), pending = gate<MetadataRead<MetadataChoiceSource>>();
    host.getChoices.mockReturnValue(pending.promise);
    const first = Metadata.getChoices("account", "category", { context: host.context });
    const second = Metadata.getChoices("account", "category", { context: host.context });
    pending.release(host.read(host.choices));
    const [a, b] = await Promise.all([first, second]);
    expect(host.getChoices).toHaveBeenCalledOnce();
    expect(a).toEqual(b);
    a.choices[0]!.label = "caller mutation";
    host.choices.Options[0]!.Labels[0]!.Label = "source mutation";
    expect(b.choices[0]!.label).toBe("");
    expect((await Metadata.getChoices("account", "category", { context: host.context })).choices[0]!.label).toBe("");
  });
  it("coalesces synchronous reentrant loaders", async () => {
    const host = fixture();
    let nested: Promise<TableMetadata> | undefined;
    host.getTable.mockImplementation(async () => {
      nested = Metadata.getTable("account", { context: host.context });
      return host.read(host.table);
    });
    await Metadata.getTable("account", { context: host.context });
    expect(await nested).toEqual({ LogicalName: "account", EntitySetName: "accounts" });
    expect(host.getTable).toHaveBeenCalledOnce();
  });
  it("expires exactly at 60,000 ms and rejects clock rollback", async () => {
    vi.useFakeTimers();
    const host = fixture();
    await Metadata.getTable("account", { context: host.context });
    vi.advanceTimersByTime(59_999);
    await Metadata.getTable("account", { context: host.context });
    expect(host.getTable).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1);
    await Metadata.getTable("account", { context: host.context });
    expect(host.getTable).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.now() - 1);
    await Metadata.getTable("account", { context: host.context });
    expect(host.getTable).toHaveBeenCalledTimes(3);
  });
  it.each([
    [{ status: 403 }, "ACCESS_DENIED"], [{ status: 404 }, "RESOURCE_NOT_FOUND"],
    [{ errorCode: -2147220960 }, "ACCESS_DENIED"], [new Error("network"), "DATA_READ_FAILED"]
  ])("does not cache adapter error %#", async (cause, code) => {
    const host = fixture();
    host.getTable.mockRejectedValue(cause);
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(Metadata.getTable("account", { context: host.context })).rejects.toMatchObject({ code, cause: undefined });
    }
    expect(host.getTable).toHaveBeenCalledTimes(2);
  });
  it("does not cache invalid results or validators that reject malformed metadata", async () => {
    const host = fixture();
    host.getTable.mockResolvedValueOnce(untrusted(host.read({ LogicalName: "account" })));
    await expect(Metadata.getTable("account", { context: host.context })).rejects.toMatchObject({ code: "DATA_RESPONSE_INVALID" });
    await Metadata.getTable("account", { context: host.context });
    expect(host.getTable).toHaveBeenCalledTimes(2);
  });
  it("isolates adapter, environment, user, UI language, label language and property selection", async () => {
    const host = fixture(), other = fixture();
    const read = () => Metadata.getTable("account", { context: host.context });
    await read();
    await Metadata.getTable("account", { context: other.context });
    host.scope.environmentUrl = "https://second.example.test"; await read();
    host.scope.userId = "22222222-2222-4222-8222-222222222222"; await read();
    host.scope.languageId = 1043; await read();
    await Metadata.getTable("account", { context: host.context, properties: ["DisplayName"] });
    expect(host.getTable).toHaveBeenCalledTimes(5);
    expect(other.getTable).toHaveBeenCalledOnce();
    await Metadata.getChoices("account", "category", { context: host.context });
    await Metadata.getChoices("account", "category", { context: host.context, languageId: 1033 });
    expect(host.getChoices).toHaveBeenCalledTimes(2);
  });
  it("canonicalizes property ordering and invalidates columns, choices and table relationships conservatively", async () => {
    const host = fixture();
    await Metadata.getTable("account", { context: host.context, properties: ["DisplayName", "Description"] });
    await Metadata.getTable("account", { context: host.context, properties: ["Description", "DisplayName"] });
    await Metadata.getColumn("account", "name", { context: host.context });
    await Metadata.getChoices("account", "category", { context: host.context });
    await Metadata.getRelationships("account", { context: host.context, kind: "oneToMany" });
    expect(host.getTable).toHaveBeenCalledOnce();
    expect(Metadata.invalidate({ context: host.context, table: "account", column: "category" })).toBe(2);
    expect(Metadata.invalidate({ context: host.context, table: "account", column: "name" })).toBe(1);
    expect(Metadata.invalidate({ context: host.context, table: "account" })).toBe(1);
    expect(Metadata.invalidate({ context: host.context })).toBe(0);
  });
  it("invalidates only selected requested language in the current source/scope", async () => {
    const host = fixture(), other = fixture();
    await Metadata.getChoices("account", "category", { context: host.context });
    await Metadata.getChoices("account", "category", { context: host.context, languageId: 1043 });
    await Metadata.getTable("account", { context: other.context });
    expect(Metadata.invalidate({ context: host.context, languageId: 1043 })).toBe(1);
    expect(Metadata.invalidate({ context: host.context, languageId: 1033 })).toBe(1);
    expect(Metadata.invalidate({ context: other.context })).toBe(1);
    expect(() => Metadata.invalidate({ context: host.context, column: "name" })).toThrowError(VbdError);
  });
  it("rejects invalidated pending work and allows a replacement load without stale repopulation", async () => {
    const host = fixture(), pending = gate<MetadataRead<TableMetadata>>();
    host.getTable.mockReturnValueOnce(pending.promise);
    const stale = Metadata.getTable("account", { context: host.context });
    const rejected = expect(stale).rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
    await vi.waitFor(() => expect(host.getTable).toHaveBeenCalledOnce());
    expect(Metadata.invalidate({ context: host.context, table: "account" })).toBe(1);
    host.table.EntitySetName = "new_accounts";
    expect((await Metadata.getTable("account", { context: host.context })).EntitySetName).toBe("new_accounts");
    pending.release(host.read({ LogicalName: "account", EntitySetName: "stale_accounts" }));
    await rejected;
    expect((await Metadata.getTable("account", { context: host.context })).EntitySetName).toBe("new_accounts");
    expect(host.getTable).toHaveBeenCalledTimes(2);
  });
  it.each(["environment", "user", "language", "offline"])("rejects pending %s scope transitions", async change => {
    const host = fixture(), pending = gate<MetadataRead<TableMetadata>>(), original = host.read(host.table);
    host.getTable.mockReturnValueOnce(pending.promise);
    const result = Metadata.getTable("account", { context: host.context });
    const rejected = expect(result).rejects.toBeInstanceOf(VbdError);
    await vi.waitFor(() => expect(host.getTable).toHaveBeenCalledOnce());
    if (change === "environment") host.scope.environmentUrl = "https://changed.example.test";
    if (change === "user") host.scope.userId = "22222222-2222-4222-8222-222222222222";
    if (change === "language") host.scope.languageId = 1043;
    if (change === "offline") host.scope.online = false;
    pending.release(original);
    await rejected;
    host.scope.online = true;
    await Metadata.getTable("account", { context: host.context });
    expect(host.getTable).toHaveBeenCalledTimes(2);
  });
  it("rejects invalidation from inside a loader and during scope checks after normalization", async () => {
    const host = fixture();
    host.getTable.mockImplementationOnce(async () => {
      Metadata.invalidate({ context: host.context });
      return host.read(host.table);
    });
    await expect(Metadata.getTable("account", { context: host.context })).rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
    await Metadata.getTable("account", { context: host.context });
    let armed = true, inside = false;
    const original = host.context.getScope;
    host.context.getScope = () => {
      if (armed && !inside) {
        armed = false; inside = true;
        Metadata.invalidate({ context: host.context });
        inside = false;
      }
      return original();
    };
    // Invalidation can occur while capturing the next observation: this must load fresh.
    await Metadata.getTable("account", { context: host.context });
    expect(host.getTable).toHaveBeenCalledTimes(3);
  });
  it.each(["invalidate", "scope"])("sweeps every cached-read/validator scope observation for reentrant %s races", async race => {
    const baseline = fixture();
    await Metadata.getTable("account", { context: baseline.context });
    let observations = 0;
    baseline.context.getScope = () => { observations++; return { ...baseline.scope }; };
    await Metadata.getTable("account", { context: baseline.context });
    expect(observations).toBeGreaterThanOrEqual(7);
    for (let target = 1; target <= observations; target++) {
      const host = fixture();
      await Metadata.getTable("account", { context: host.context });
      let reads = 0, armed = true;
      host.context.getScope = () => {
        if (++reads === target && armed) {
          armed = false;
          host.table.EntitySetName = "updated_accounts";
          if (race === "invalidate") Metadata.invalidate({ context: host.context });
          else host.scope.userId = "22222222-2222-4222-8222-222222222222";
        }
        return { ...host.scope };
      };
      try {
        const output = await Metadata.getTable("account", { context: host.context });
        expect(output.EntitySetName).toBe("updated_accounts");
      } catch (error) {
        expect(error).toMatchObject({ code: "CONFIG_EXPIRED" });
      }
      expect(armed).toBe(false);
      expect((await Metadata.getTable("account", { context: host.context })).EntitySetName).toBe("updated_accounts");
      expect(host.getTable).toHaveBeenCalledTimes(2);
    }
  });
  it("rejects a default-language change between label-language selection and cache observation", async () => {
    const host = fixture();
    let count = 0;
    host.context.getScope = () => {
      if (++count === 2) host.scope.languageId = 1043;
      return { ...host.scope };
    };
    await expect(Metadata.getChoices("account", "category", { context: host.context }))
      .rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
    expect(host.getChoices).not.toHaveBeenCalled();
    expect((await Metadata.getChoices("account", "category", { context: host.context })).languageId).toBe(1043);
  });
  it("shares environment-generation invalidation with the existing cache", async () => {
    const host = fixture(), pending = gate<MetadataRead<TableMetadata>>();
    host.getTable.mockReturnValueOnce(pending.promise);
    const result = Metadata.getTable("account", { context: host.context });
    const rejected = expect(result).rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
    await vi.waitFor(() => expect(host.getTable).toHaveBeenCalledOnce());
    Environment.invalidate(undefined, { context: {
      getScope: host.context.getScope,
      retrieveMultipleRecords: async () => { throw new Error("record reads prohibited"); }
    } });
    pending.release(host.read(host.table));
    await rejected;
    await Metadata.getTable("account", { context: host.context });
    expect(host.getTable).toHaveBeenCalledTimes(2);
  });
  it("measures the 128-route/slot capacity and evicts oldest entries", async () => {
    const host = fixture();
    host.getTable.mockImplementation(async (...args: unknown[]) => host.read({
      LogicalName: String(args[0]), EntitySetName: `${String(args[0])}s`
    }));
    for (let i = 0; i < 129; i++) await Metadata.getTable(`table${i}`, { context: host.context });
    expect(host.getTable).toHaveBeenCalledTimes(129);
    await Metadata.getTable("table0", { context: host.context });
    expect(host.getTable).toHaveBeenCalledTimes(130);
    expect(Metadata.invalidate({ context: host.context })).toBe(128);
  });
  it("measures the shared cache's 64-active-load bound without dispatching the 65th", async () => {
    const host = fixture(), pending = gate<void>();
    host.getTable.mockImplementation(async (...args: unknown[]) => {
      await pending.promise;
      return host.read({ LogicalName: String(args[0]), EntitySetName: `${String(args[0])}s` });
    });
    const requests = Array.from({ length: 64 }, (_, i) => Metadata.getTable(`table${i}`, { context: host.context }));
    await vi.waitFor(() => expect(host.getTable).toHaveBeenCalledTimes(64));
    await expect(Metadata.getTable("overflow", { context: host.context })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    pending.release();
    expect(await Promise.all(requests)).toHaveLength(64);
    expect(host.getTable).toHaveBeenCalledTimes(64);
    expect(Metadata.invalidate({ context: host.context })).toBe(64);
  });
  it("reuses shared Cache invalidation without leaving reachable stale results", async () => {
    const host = fixture();
    await Metadata.getTable("account", { context: host.context });
    Cache.clear({ context: {
      getScope: host.context.getScope,
      retrieveMultipleRecords: async () => { throw new Error("record reads prohibited"); }
    } });
    await Metadata.getTable("account", { context: host.context });
    expect(host.getTable).toHaveBeenCalledTimes(2);
  });
});
