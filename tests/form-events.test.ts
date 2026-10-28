import { afterEach, describe, expect, it, vi } from "vitest";
import { Events } from "../src/events.js";
import { Lookups, Choices } from "../src/lookups.js";
import { Commands } from "../src/commands.js";
import { Config } from "../src/configuration.js";
import { Context } from "../src/context.js";
import { Environment } from "../src/environment.js";
import { checkedXml } from "../src/xml.js";
import { nativeForm, nativeGrid, nativeSdk } from "./native-fixture.js";
import { appId, deferred, launchFixture } from "./environment-helpers.js";
import { configuration } from "./helpers.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("owned events and synchronous save validation", () => {
  it("registers once per handler/target, disposes only its own handler and supports data load/save", () => {
    const host = nativeForm(), handler = vi.fn(), unrelated = vi.fn();
    host.field("name").handlers.add(unrelated);
    const first = Events.register(host.form, { event: "change", column: "name" }, handler);
    expect(Events.register(host.form, { event: "change", column: "name" }, handler)).toBe(first);
    expect(host.field("name").attribute.addOnChange).toHaveBeenCalledOnce();
    host.field("name").attribute.fireOnChange();
    expect(handler).toHaveBeenCalledOnce();
    expect(Events.unregister(first)).toEqual({ removed: true });
    expect(Events.unregister(first)).toEqual({ removed: false });
    expect(host.field("name").handlers.has(unrelated)).toBe(true);
    expect(() => Events.unregister({ ...first })).toThrow();
    const load = Events.register(host.form, { event: "load" }, handler);
    const save = Events.register(host.form, { event: "save" }, handler);
    expect(host.loadHandlers.has(handler)).toBe(true);
    expect(host.saveHandlers.has(handler)).toBe(true);
    expect(load.dispose()).toEqual({ removed: true });
    expect(save.dispose()).toEqual({ removed: true });
    expect(() => Events.register(host.form, { event: "change" }, handler)).toThrow();
    expect(() => Events.register(host.form, { event: "save", column: "name" }, handler)).toThrow();
  });

  it("blocks saves before returning and never prepares or saves implicitly", () => {
    const host = nativeForm();
    const result = Events.onSave(host.execution, JSON.stringify([
      { id: "requiredName", field: "name", kind: "required", message: "Enter a name." }
    ]));
    expect(result).not.toBeInstanceOf(Promise);
    expect(result).toMatchObject({ valid: false, prevented: true });
    expect(host.args.preventDefault).toHaveBeenCalledOnce();
    expect(host.form.data.save).not.toHaveBeenCalled();
    expect(() => Events.onSave(host.execution, '{"workflow":"INVALID_CANARY"}')).toThrow();
    expect(host.args.preventDefault).toHaveBeenCalledTimes(2);
  });

  it("caps owned registrations at 100 without clearing unrelated state", () => {
    const host = nativeForm();
    const tokens = Array.from({ length: 100 }, () =>
      Events.register(host.form, { event: "change", column: "name" }, () => undefined));
    expect(() => Events.register(host.form, { event: "change", column: "name" }, () => undefined))
      .toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
    for (const token of tokens) Events.unregister(token);
    expect(host.field("name").handlers.size).toBe(0);
  });
});

describe("lookup filters, pickers and choices", () => {
  const xml = "<filter type='and'><condition attribute='name' operator='eq' value='A &amp; B'/></filter>";
  it("applies validated filters only inside PreSearch and disposes owned callbacks idempotently", () => {
    const host = nativeForm();
    const lookup = host.field("lookup").body;
    const unrelated = vi.fn();
    lookup.preSearch.add(unrelated);
    const token = Lookups.addFilter(host.form, "lookup", xml, "account");
    expect(Lookups.addFilter(host.form, "lookup", xml, "account")).toBe(token);
    expect(lookup.control.addCustomFilter).not.toHaveBeenCalled();
    lookup.search();
    expect(lookup.control.addCustomFilter).toHaveBeenCalledExactlyOnceWith(xml, "account");
    expect(Lookups.removeFilter(token)).toEqual({ removed: true });
    expect(Lookups.removeFilter(token)).toEqual({ removed: false });
    expect(lookup.preSearch.has(unrelated)).toBe(true);
    expect(() => Events.unregister(token)).toThrow();
    expect(() => Lookups.removeFilter({ ...token })).toThrow();
    Lookups.setDefaultView(host.form, "lookup", `{${appId}}`);
    Lookups.setEntityTypes(host.form, "lookup", ["ACCOUNT", "contact"]);
    expect(lookup.control.setDefaultView).toHaveBeenCalledWith(appId);
    expect(lookup.state.targets).toEqual(["account", "contact"]);
  });

  it.each([
    "<filter><broken></filter>",
    "<fetch><entity name='account'/></fetch>",
    "<!DOCTYPE filter [<!ENTITY x 'private'>]><filter>&x;</filter>",
    "<filter/><filter/>",
    "<filter>\u0000</filter>",
    "<filter>\ud800</filter>"
  ])("rejects malformed, wrong-root or entity-bearing XML before registration: %s", (input) => {
    const host = nativeForm();
    expect(() => Lookups.addFilter(host.form, "lookup", input)).toThrow();
    expect(host.field("lookup").body.control.addPreSearch).not.toHaveBeenCalled();
  });

  it("measures XML bounds in UTF-8 bytes and preserves built-in entity semantics", () => {
    expect(checkedXml(xml, "filter").root).toMatchObject({
      condition: { "@_attribute": "name", "@_operator": "eq", "@_value": "A & B" }
    });
    const exact = `<filter>${" ".repeat(262144 - 17)}</filter>`;
    expect(new TextEncoder().encode(exact).byteLength).toBe(262144);
    expect(() => checkedXml(exact, "filter")).not.toThrow();
    expect(() => checkedXml(exact + " ", "filter")).toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
    expect(() => checkedXml(`<filter>${"é".repeat(131064)}</filter>`, "filter"))
      .toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
  });

  it("returns explicit picker cancellation and verifies result table/cardinality", async () => {
    const sdk = nativeSdk();
    vi.stubGlobal("Xrm", sdk.xrm);
    expect(await Lookups.pick({ entityTypes: ["account"] })).toEqual({ status: "cancelled", records: [] });
    sdk.utility.lookupObjects.mockResolvedValueOnce(undefined);
    expect((await Lookups.pick({ entityTypes: ["account"] })).status).toBe("cancelled");
    sdk.utility.lookupObjects.mockResolvedValueOnce([{ entityType: "account", id: appId, name: "Fixture" }]);
    expect(await Lookups.pick({
      entityTypes: ["ACCOUNT"], defaultEntityType: "ACCOUNT", filters: [{ filterXml: xml, entityLogicalName: "ACCOUNT" }]
    })).toMatchObject({ status: "selected", records: [{ entityType: "account", id: appId, name: "Fixture" }] });
    expect(sdk.utility.lookupObjects).toHaveBeenLastCalledWith(expect.objectContaining({
      entityTypes: ["account"], defaultEntityType: "account",
      filters: [{ filterXml: xml, entityLogicalName: "account" }]
    }));
    sdk.utility.lookupObjects.mockResolvedValueOnce([{ entityType: "contact", id: appId }]);
    await expect(Lookups.pick({ entityTypes: ["account"] })).rejects.toMatchObject({ code: "DATA_RESPONSE_INVALID" });
    sdk.utility.lookupObjects.mockResolvedValueOnce([
      { entityType: "account", id: appId }, { entityType: "account", id: crypto.randomUUID() }
    ]);
    await expect(Lookups.pick({ entityTypes: ["account"] })).rejects.toThrow();
    await expect(Lookups.pick({ entityTypes: ["account"], defaultEntityType: "contact" })).rejects.toThrow();
  });

  it("keeps numeric choice values and never creates metadata", () => {
    const host = nativeForm();
    expect(Choices.getOptions(host.form, "choices")).toEqual([{ value: 1, text: "One" }, { value: 2, text: "Two" }]);
    expect(() => Choices.getOptions(host.form, "name")).toThrow(expect.objectContaining({ code: "FIELD_TYPE_MISMATCH" }));
    expect(host.form.data.save).not.toHaveBeenCalled();
  });
});

describe("maker command preparation and gesture boundary", () => {
  function setup() {
    const sdk = nativeSdk(), source = launchFixture(), host = nativeForm(), grid = nativeGrid();
    vi.stubGlobal("Xrm", sdk.xrm);
    const open = vi.fn(() => null);
    const activation = { isActive: true };
    vi.stubGlobal("open", open);
    vi.stubGlobal("navigator", { userActivation: activation });
    const name = `command-${crypto.randomUUID()}`;
    Config.register(name, configuration());
    return { sdk, source, host, grid, open, activation, name, key: `${name}/customerWorkspace` };
  }
  it("opens from form/grid commands synchronously before their returned promise settles", async () => {
    const fixture = setup();
    expect(await Events.onLoad(fixture.host.execution, fixture.key, { context: fixture.source.context }))
      .toEqual({ status: "prepared" });
    const reads = fixture.source.retrieve.mock.calls.length;
    const pending = Commands.run(fixture.host.form, fixture.key);
    expect(fixture.open).toHaveBeenCalledOnce();
    expect(fixture.source.retrieve).toHaveBeenCalledTimes(reads);
    await expect(pending).resolves.toMatchObject({ status: "requested", outcome: "unknown" });
    await expect(Commands.runGrid(fixture.grid.grid, [appId], fixture.key)).resolves.toMatchObject({ status: "requested" });
    expect(fixture.open).toHaveBeenCalledTimes(2);
    expect(Commands.execute(Context.fromFormCommand(fixture.host.form), fixture.key).status).toBe("requested");
  });

  it("shows a safe error once and returns failed, never a success-shaped fallback", async () => {
    const fixture = setup();
    const result = await Commands.run(fixture.host.form, fixture.key);
    expect(result).toMatchObject({ status: "failed", error: { code: "CONFIG_NOT_READY" } });
    expect(fixture.sdk.navigation.openErrorDialog).toHaveBeenCalledOnce();
    expect(fixture.open).not.toHaveBeenCalled();
    fixture.sdk.navigation.openErrorDialog.mockRejectedValueOnce(new Error("PRESENTATION_CANARY"));
    await expect(Commands.run(fixture.host.form, fixture.key)).rejects.toMatchObject({ code: "ERROR_PRESENTATION_FAILED" });
  });

  it("keeps clicks not-ready during preparation and refreshes on change without saving", async () => {
    const fixture = setup(), gate = deferred();
    const original = fixture.source.retrieve.getMockImplementation();
    if (!original) throw new Error("Missing fixture implementation.");
    fixture.source.retrieve.mockImplementation(async (...args) => { await gate.promise; return original(...args); });
    const loading = Events.onChange(fixture.host.execution, fixture.key, { context: fixture.source.context });
    expect((await Commands.run(fixture.host.form, fixture.key)).status).toBe("failed");
    expect(fixture.open).not.toHaveBeenCalled();
    gate.release();
    expect((await loading).status).toBe("prepared");
    expect((await Commands.run(fixture.host.form, fixture.key)).status).toBe("requested");
    expect(fixture.host.form.data.save).not.toHaveBeenCalled();
  });

  it("rejects expired/invalidation state, malformed keys and input overrides", async () => {
    const fixture = setup();
    await Events.onLoad(fixture.host.execution, fixture.key, { context: fixture.source.context });
    Environment.invalidate(undefined, { context: fixture.source.context });
    const result = await Commands.run(fixture.host.form, fixture.key);
    expect(result).toMatchObject({ status: "failed", error: { code: "CONFIG_EXPIRED" } });
    expect(fixture.open).not.toHaveBeenCalled();
    expect(() => Commands.execute(Context.fromFormCommand(fixture.host.form), "bad/key/extra")).toThrow();
    const invalid = await Reflect.apply(Events.onLoad, undefined, [fixture.host.execution, fixture.key, {
      context: fixture.source.context, configurationName: "override"
    }]);
    expect(invalid).toMatchObject({ status: "failed", error: { code: "INVALID_ARGUMENT" } });
  });

  it("handles superseded preparations without an obsolete error or delayed popup", async () => {
    const fixture = setup(), gate = deferred();
    const original = fixture.source.retrieve.getMockImplementation();
    if (!original) throw new Error("Missing fixture implementation.");
    fixture.source.retrieve.mockImplementation(async (...args) => { await gate.promise; return original(...args); });
    const first = Events.onLoad(fixture.host.execution, fixture.key, { context: fixture.source.context });
    const second = Events.onLoad(fixture.host.execution, fixture.key, { context: fixture.source.context });
    gate.release();
    expect((await first).status).toBe("superseded");
    expect((await second).status).toBe("prepared");
    expect(fixture.open).not.toHaveBeenCalled();
    expect(fixture.sdk.navigation.openErrorDialog).not.toHaveBeenCalled();
  });
});
