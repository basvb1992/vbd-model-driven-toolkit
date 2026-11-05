import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { Context } from "../src/context.js";
import { Environment } from "../src/environment.js";
import { VbdError } from "../src/errors.js";
import { Lookups } from "../src/lookups.js";
import type { DependentLookupOptions, LookupViewOptions } from "../src/lookups.js";
import type { ReadContext } from "../src/platform.js";
import type { SdkObject } from "../src/sdk.js";

const id = (n = 1) => `10000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;
const ref = (n = 1) => ({ entityType: "account", id: id(n), name: `Record ${n}` });
const xml = (value = "A &amp; B") => `<filter type="and"><condition attribute="name" operator="eq" value="${value}"/></filter>`;
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type Handler = (event: unknown) => unknown;
function host() {
  const scope = { environmentUrl: "https://fixture.crm.dynamics.com", userId: id(90), languageId: 1033, online: true };
  const context: ReadContext = {
    getScope: vi.fn(() => ({ ...scope })),
    retrieveMultipleRecords: vi.fn(async () => { throw new Error("No business reads permitted."); })
  };
  const state = { record: id(70), form: id(80), currentItem: true };
  const attributes = new Map<string, SdkObject>(), controls = new Map<string, SdkObject>();
  const loads = new Set<Handler>();
  function field(name: string) {
    const value = {
      refs: [ref()] as unknown, type: "lookup", party: false, controlType: "lookup", tables: ["account"],
      defaultView: id(99), boundAttribute: null as SdkObject | null
    };
    const changes = new Set<Handler>(), searches = new Set<Handler>();
    const attribute = {
      getName: vi.fn(function(this: unknown): string { expect(this).toBe(attribute); return name; }),
      getAttributeType: vi.fn(function(this: unknown): string { expect(this).toBe(attribute); return value.type; }),
      getIsPartyList: vi.fn(function(this: unknown): boolean { expect(this).toBe(attribute); return value.party; }),
      getValue: vi.fn(function(this: unknown): unknown { expect(this).toBe(attribute); return value.refs; }),
      setValue: vi.fn(function(this: unknown, next: unknown): void { expect(this).toBe(attribute); value.refs = next; }),
      fireOnChange: vi.fn(),
      addOnChange: vi.fn(function(this: unknown, handler: Handler): void { expect(this).toBe(attribute); changes.add(handler); }),
      removeOnChange: vi.fn(function(this: unknown, handler: Handler): void { expect(this).toBe(attribute); changes.delete(handler); })
    };
    value.boundAttribute = attribute;
    const control = {
      getControlType: vi.fn(function(this: unknown): string { expect(this).toBe(control); return value.controlType; }),
      getAttribute: vi.fn(function(this: unknown): unknown { expect(this).toBe(control); return value.boundAttribute; }),
      getEntityTypes: vi.fn(function(this: unknown): string[] { expect(this).toBe(control); return value.tables; }),
      getDefaultView: vi.fn(function(this: unknown): string { expect(this).toBe(control); return value.defaultView; }),
      addCustomView: vi.fn(function(
        this: unknown, viewId: string, _table: string, _label: string, _fetch: string, _layout: string, isDefault: boolean
      ): void { expect(this).toBe(control); if (isDefault) value.defaultView = viewId; }),
      addCustomFilter: vi.fn(function(this: unknown): void { expect(this).toBe(control); }),
      addPreSearch: vi.fn(function(this: unknown, handler: Handler): void { expect(this).toBe(control); searches.add(handler); }),
      removePreSearch: vi.fn(function(this: unknown, handler: Handler): void { expect(this).toBe(control); searches.delete(handler); })
    };
    attributes.set(name, attribute); controls.set(name, control);
    return {
      value, attribute, control, searches, changes,
      change: () => [...changes].map(handler => handler(event(attribute))),
      search: () => [...searches].map(handler => handler(event(control)))
    };
  }
  const parent = field("parent"), child = field("child"), other = field("other"), owner = field("ownerid");
  const item = { getId: vi.fn(function(this: unknown): string { expect(this).toBe(item); return state.form; }) };
  const entity = {
    getId: vi.fn(function(this: unknown): string { expect(this).toBe(entity); return state.record; }),
    getEntityName: vi.fn(function(this: unknown): string { expect(this).toBe(entity); return "account"; })
  };
  const data = {
    entity, save: vi.fn(),
    addOnLoad: vi.fn(function(this: unknown, handler: Handler): void { expect(this).toBe(data); loads.add(handler); }),
    removeOnLoad: vi.fn(function(this: unknown, handler: Handler): void { expect(this).toBe(data); loads.delete(handler); })
  };
  const selector = {
    getCurrentItem: vi.fn(function(this: unknown): unknown { expect(this).toBe(selector); return state.currentItem ? item : null; })
  };
  const form = {
    getAttribute: vi.fn(function(this: unknown, name: string): unknown { expect(this).toBe(form); return attributes.get(name) ?? null; }),
    getControl: vi.fn(function(this: unknown, name: string): unknown { expect(this).toBe(form); return controls.get(name) ?? null; }),
    data, ui: { formSelector: selector }
  };
  function event(source: unknown, suppliedForm: unknown = form) {
    return { getFormContext: () => suppliedForm, getEventSource: () => source };
  }
  const options: DependentLookupOptions = {
    parentColumn: "parent", parentTables: ["account"], childControl: "child", entityType: "account",
    lookupKind: "standard", ownerLookup: false, selectionOnInvalidate: "retain-invalid", emptyParent: "not-ready",
    prepare: vi.fn(() => xml()), onError: vi.fn(), context
  };
  return {
    form, data, context, scope, state, parent, child, other, owner, attributes, controls, loads, options, event, field,
    load: () => [...loads].map(handler => handler(event(data)))
  };
}
function view(): LookupViewOptions {
  return {
    lookupKind: "standard", ownerLookup: false, identityPolicy: "caller-unique",
    viewId: id(10), entityType: "account", displayName: "Local view", tableTypeCode: 1,
    primaryIdColumn: "accountid", primaryNameColumn: "name", isDefault: false,
    fetchXml: `<fetch version="1.0" output-format="xml-platform" mapping="logical" distinct="false"><entity name="account"><attribute name="accountid"/><attribute name="name"/><order attribute="name" descending="false"/>${xml()}</entity></fetch>`,
    layoutXml: '<grid name="resultset" object="1" jump="name" select="1" icon="1" preview="1"><row name="result" id="accountid"><cell name="name" width="200"/></row></grid>'
  };
}
function unsafeView(h: ReturnType<typeof host>, options: unknown) {
  return Reflect.apply(Lookups.addView, undefined, [h.form, "child", options]);
}
function thrown(run: () => unknown): VbdError {
  try { run(); }
  catch (error) { if (error instanceof VbdError) return error; throw error; }
  throw new Error("Expected failure");
}

describe("bounded native custom views", () => {
  it("uses the supplied event context and native receivers, returns a non-removable copied receipt", () => {
    const h = host(), options = view();
    const receipt = Lookups.addView(Context.fromFormEvent(h.event(h.data)), "child", options);
    expect(receipt).toEqual({ status: "requested", viewId: id(10), entityType: "account", removable: false });
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(h.child.control.addCustomView).toHaveBeenCalledExactlyOnceWith(
      id(10), "account", "Local view", options.fetchXml, options.layoutXml, false
    );
    expect(Lookups.addView(h.form, "child", { ...options })).toMatchObject({ status: "existing" });
    options.displayName = "Changed";
    expect(() => Lookups.addView(h.form, "child", options)).toThrow(expect.objectContaining({ code: "RESOURCE_CONFLICT" }));
    expect(h.child.control.addCustomView).toHaveBeenCalledOnce();
    expect(h.data.save).not.toHaveBeenCalled();
  });
  it("accepts a declared default request but never calls a separate setDefaultView or removes a view", () => {
    const h = host(), options = { ...view(), isDefault: true };
    expect(Lookups.addView(h.form, "child", options).status).toBe("requested");
    expect(h.child.value.defaultView).toBe(options.viewId);
    expect(Lookups.addView(h.form, "child", options).status).toBe("existing");
  });
  it.each([
    { ownerLookup: true }, { lookupKind: "owner" }, { identityPolicy: "replace" }, { tableTypeCode: 0 },
    { isDefault: "false" }, { displayName: "" }, { displayName: "x".repeat(257) }, { viewId: "bad" },
    { primaryIdColumn: "id bad" }, { bogus: true }, { entityType: "contact" },
    { primaryIdColumn: "contactid" }, { primaryNameColumn: "other" }, { tableTypeCode: 2 }
  ])("rejects option and identity mismatch before native mutation: %j", patch => {
    const h = host();
    expect(() => unsafeView(h, { ...view(), ...patch })).toThrow();
    expect(h.child.control.addCustomView).not.toHaveBeenCalled();
  });
  it.each([
    '<fetch/>',
    '<!DOCTYPE fetch><fetch/>',
    '<?xml version="1.0"?><fetch/>',
    '<fetch><entity name="account"/></fetch>',
    '<fetch/><fetch/>',
    "<fetch>\u0000</fetch>",
    "<fetch>\ud800</fetch>"
  ])("rejects wrong/unsafe fetch shape: %s", fetchXml => {
    const h = host();
    expect(() => Lookups.addView(h.form, "child", { ...view(), fetchXml })).toThrow();
    expect(h.child.control.addCustomView).not.toHaveBeenCalled();
  });
  it.each([
    (s: string) => s.replace('distinct="false"', 'distinct="true"'),
    (s: string) => s.replace('<entity name="account">', '<entity name="account" enableprefiltering="1">'),
    (s: string) => s.replace('<attribute name="name"/>', '<attribute name="name"/><attribute name="name"/>'),
    (s: string) => s.replace('<attribute name="accountid"/>', ""),
    (s: string) => s.replace('<order attribute="name"', '<order attribute="absent"'),
    (s: string) => s.replace('attribute="name" operator=', 'attribute="absent" operator='),
    (s: string) => s.replace('operator="eq"', 'operator="like"'),
    (s: string) => s.replace("A &amp; B", "&#0;"),
    (s: string) => s.replace("A &amp; B", "&unknown;"),
    (s: string) => s.replace("A &amp; B", "x".repeat(2049)),
    (s: string) => s.replace("</entity>", '<link-entity name="contact"/></entity>'),
    (s: string) => s.replace("</entity>", "<!-- comment --></entity>")
  ])("rejects unsupported fetch fields, entities and conditions", mutate => {
    const h = host(), options = view();
    expect(() => Lookups.addView(h.form, "child", { ...options, fetchXml: mutate(options.fetchXml) })).toThrow();
    expect(h.child.control.addCustomView).not.toHaveBeenCalled();
  });
  it.each([
    (s: string) => s.replace('object="1"', 'object="2"'),
    (s: string) => s.replace('id="accountid"', 'id="contactid"'),
    (s: string) => s.replace('jump="name"', 'jump="other"'),
    (s: string) => s.replace('width="200"', 'width="1001"'),
    (s: string) => s.replace('width="200"', 'width="0"'),
    (s: string) => s.replace('width="200"', 'width="200" imageproviderfunctionname="run"'),
    (s: string) => s.replace('<cell name="name"', '<cell name="absent"'),
    (s: string) => s.replace('</row>', '<cell name="name" width="20"/></row>'),
    (s: string) => s.replace('</grid>', '</grid><grid/>'),
    (s: string) => s.replace('<grid ', '<grid onload="run" '),
    (s: string) => s.replace('<cell ', '<cell xmlns="bad" ')
  ])("rejects unsupported layout, duplicate cells and mismatches", mutate => {
    const h = host(), options = view();
    expect(() => Lookups.addView(h.form, "child", { ...options, layoutXml: mutate(options.layoutXml) })).toThrow();
    expect(h.child.control.addCustomView).not.toHaveBeenCalled();
  });
  it("bounds attributes, cells, orders, filters, total width and UTF-8 bytes before mutation", () => {
    const h = host();
    function wide(count: number, width: number): LookupViewOptions {
      const options = view();
      const fields = ["accountid", "name", ...Array.from({ length: count - 2 }, (_, n) => `field${n}`)];
      options.fetchXml = options.fetchXml.replace('<attribute name="accountid"/><attribute name="name"/>',
        fields.map(name => `<attribute name="${name}"/>`).join(""));
      options.layoutXml = options.layoutXml.replace('<cell name="name" width="200"/>',
        fields.slice(1).map(name => `<cell name="${name}" width="${width}"/>`).join(""));
      return options;
    }
    Lookups.addView(h.form, "child", wide(21, 500)); // 20 cells and 10,000 total width.
    h.child.control.addCustomView.mockClear();
    for (const options of [wide(22, 400), wide(21, 501), wide(51, 10),
      { ...view(), fetchXml: view().fetchXml.replace('</entity>', `${'<order attribute="name" descending="false"/>'.repeat(5)}</entity>`) },
      { ...view(), fetchXml: view().fetchXml.replace('</filter>', `${'<condition attribute="name" operator="null"/>'.repeat(50)}</filter>`) },
      { ...view(), fetchXml: view().fetchXml.replace('</fetch>', `${"é".repeat(131072)}</fetch>`) }
    ]) expect(() => Lookups.addView(h.form, "child", options)).toThrow();
    expect(h.child.control.addCustomView).not.toHaveBeenCalled();
  });
  it.each(["owner", "party", "wrong-type", "unsupported", "missing-method", "unbound", "wrong-target"])(
    "rejects %s controls before mutation", kind => {
      const h = host();
      if (kind === "owner") {
        expect(() => Lookups.addView(h.form, "ownerid", view())).toThrow();
        expect(h.owner.control.addCustomView).not.toHaveBeenCalled();
        return;
      }
      if (kind === "party") h.child.value.party = true;
      if (kind === "wrong-type") h.child.value.type = "string";
      if (kind === "unsupported") h.child.value.controlType = "customcontrol:test";
      if (kind === "missing-method") Reflect.deleteProperty(h.child.control, "addCustomView");
      if (kind === "unbound") { h.child.value.boundAttribute = h.other.attribute; h.attributes.delete("other"); }
      if (kind === "wrong-target") h.child.value.tables = ["contact"];
      expect(() => Lookups.addView(h.form, "child", view())).toThrow();
      expect(h.child.control.addPreSearch).not.toHaveBeenCalled();
    }
  );
  it("reserves uncertain native requests without retrying and rejects the known default view ID", () => {
    const h = host(), cause = new Error("Native may have added the view");
    expect(() => Lookups.addView(h.form, "child", { ...view(), viewId: id(99) })).toThrow();
    h.child.control.addCustomView.mockImplementationOnce(() => { throw cause; });
    const error = thrown(() => Lookups.addView(h.form, "child", view()));
    expect(error.code).toBe("MUTATION_OUTCOME_UNKNOWN");
    expect(error.cause).toMatchObject({ cause });
    expect(() => Lookups.addView(h.form, "child", view())).toThrow(expect.objectContaining({ code: "MUTATION_OUTCOME_UNKNOWN" }));
    expect(h.child.control.addCustomView).toHaveBeenCalledOnce();
  });
  it("caps view identities at 32 per actual control, including uncertain requests", () => {
    const h = host();
    for (let n = 1; n <= 32; n++) Lookups.addView(h.form, "child", { ...view(), viewId: id(n) });
    expect(() => Lookups.addView(h.form, "child", { ...view(), viewId: id(33) }))
      .toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
    expect(h.child.control.addCustomView).toHaveBeenCalledTimes(32);
  });
  it("observes/rejects an unsupported asynchronous native addCustomView response as uncertain", async () => {
    const h = host();
    Reflect.set(h.child.control, "addCustomView", () => Promise.reject(new Error("Not a native void API")));
    expect(() => Lookups.addView(h.form, "child", view())).toThrow(expect.objectContaining({ code: "MUTATION_OUTCOME_UNKNOWN" }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(() => Lookups.addView(h.form, "child", view())).toThrow(expect.objectContaining({ code: "MUTATION_OUTCOME_UNKNOWN" }));
  });
  it("accepts exactly 50 attributes, five distinct orders and 50 bounded conditions but rejects 51 attributes", () => {
    const h = host(), options = view();
    const fields = ["accountid", "name", ...Array.from({ length: 48 }, (_, n) => `field${n}`)];
    options.fetchXml = options.fetchXml.replace('<attribute name="accountid"/><attribute name="name"/>',
      fields.map(name => `<attribute name="${name}"/>`).join(""))
      .replace('<order attribute="name" descending="false"/>',
        fields.slice(0, 5).map(name => `<order attribute="${name}" descending="false"/>`).join(""))
      .replace(xml(), `<filter type="or">${fields.map(name => `<condition attribute="${name}" operator="ne" value="${"x".repeat(2048)}"/>`).join("")}</filter>`);
    Lookups.addView(h.form, "child", options);
    expect(() => Lookups.addView(h.form, "child", {
      ...options, viewId: id(11), fetchXml: options.fetchXml.replace('</entity>', '<attribute name="extra"/></entity>')
    })).toThrow();
    expect(h.child.control.addCustomView).toHaveBeenCalledOnce();
  });
});

describe("owned dependency preparation before synchronous PreSearch", () => {
  it("is identity-idempotent, copies snapshots, keeps unrelated handlers and disposes opaquely", async () => {
    const h = host(), foreign = vi.fn();
    h.parent.changes.add(foreign); h.child.searches.add(foreign); h.loads.add(foreign);
    const parentRefs = [ref()];
    h.parent.value.refs = parentRefs;
    const binding = Lookups.bindDependent(Context.fromFormCommand(h.form), h.options);
    expect(Lookups.bindDependent(h.form, { ...h.options, parentTables: ["account"] })).toBe(binding);
    expect(await binding.readiness).toMatchObject({ status: "ready", parent: [ref()], selection: "retained-unvalidated" });
    expect(h.child.control.addCustomFilter).not.toHaveBeenCalled();
    const copy = binding.state;
    if (copy.status === "ready") copy.parent[0]!.id = id(2);
    expect(binding.state).toMatchObject({ parent: [ref()] });
    expect(h.child.search()).toEqual([undefined, undefined]);
    expect(h.child.control.addCustomFilter).toHaveBeenCalledExactlyOnceWith(xml(), "account");
    expect(h.child.attribute.setValue).not.toHaveBeenCalled();
    expect(h.child.attribute.fireOnChange).not.toHaveBeenCalled();
    expect(h.data.save).not.toHaveBeenCalled();
    expect(() => ({ ...binding }).dispose()).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
    expect(binding.dispose()).toEqual({ removed: true });
    expect(binding.dispose()).toEqual({ removed: false });
    expect(h.parent.changes).toEqual(new Set([foreign]));
    expect(h.child.searches).toEqual(new Set([foreign]));
    expect(h.loads).toEqual(new Set([foreign]));
    expect(await binding.refresh()).toMatchObject({ status: "not-ready", reason: "disposed" });
    expect(h.context.retrieveMultipleRecords).not.toHaveBeenCalled();
  });
  it("exposes not-ready synchronously to a registered error sink; a pending preparation can still complete", async () => {
    const h = host(), pending = deferred<string>();
    h.options.prepare = () => pending.promise;
    const binding = Lookups.bindDependent(h.form, h.options), readiness = binding.readiness;
    await Promise.resolve();
    expect(binding.state).toMatchObject({ status: "not-ready", reason: "preparing" });
    expect(() => h.child.search()).toThrow(expect.objectContaining({ code: "CONFIG_NOT_READY" }));
    expect(h.options.onError).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: "CONFIG_NOT_READY" }), scope: expect.any(String)
    }));
    expect(h.child.control.addCustomFilter).not.toHaveBeenCalled();
    pending.resolve(xml());
    expect(await readiness).toMatchObject({ status: "ready" });
    expect(h.child.search()).toEqual([undefined]);
    binding.dispose();
  });
  it("prepares on actual parent changes and observed A-B-A events discard both old runs", async () => {
    const h = host(), first = deferred<string>(), second = deferred<string>(), third = deferred<string>();
    const prepare = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    h.options.prepare = prepare;
    const binding = Lookups.bindDependent(h.form, h.options), old = binding.readiness;
    await Promise.resolve();
    h.parent.value.refs = [ref(2)]; expect(h.parent.change()).toEqual([undefined]);
    const middle = binding.readiness; await Promise.resolve();
    h.parent.value.refs = [ref()]; h.parent.change();
    const latest = binding.readiness; await Promise.resolve();
    second.resolve(xml("second")); first.resolve(xml("first")); third.resolve(xml("third"));
    expect(await old).toMatchObject({ status: "failed", error: { code: "CONFIG_EXPIRED" } });
    expect(await middle).toMatchObject({ status: "failed", error: { code: "CONFIG_EXPIRED" } });
    expect(await latest).toMatchObject({ status: "ready", parent: [ref()] });
    h.child.search();
    expect(h.child.control.addCustomFilter).toHaveBeenCalledExactlyOnceWith(xml("third"), "account");
    binding.dispose();
  });
  it("detects unobserved current parent drift before native search, without dropping refs under retain-invalid", async () => {
    const h = host(), selected = h.child.value.refs, binding = Lookups.bindDependent(h.form, h.options);
    await binding.readiness;
    h.parent.value.refs = [ref(2)];
    expect(() => h.child.search()).toThrow(expect.objectContaining({ code: "CONFIG_EXPIRED" }));
    expect(h.child.value.refs).toBe(selected);
    expect(h.child.control.addCustomFilter).not.toHaveBeenCalled();
    binding.dispose();
  });
  it("clears only with explicit consent on initial preparation, change and load; never fires OnChange or saves", async () => {
    const h = host();
    h.options.selectionOnInvalidate = "clear";
    const binding = Lookups.bindDependent(h.form, h.options);
    await binding.readiness;
    expect(h.child.value.refs).toBeNull();
    h.child.value.refs = [ref(5)]; h.parent.value.refs = null; h.parent.change();
    expect(await binding.readiness).toMatchObject({ status: "not-ready", reason: "parent-empty", selection: "cleared" });
    h.child.value.refs = [ref(6)]; h.parent.value.refs = [ref(2)]; h.load();
    expect(await binding.readiness).toMatchObject({ status: "ready", parent: [ref(2)] });
    expect(h.child.attribute.setValue).toHaveBeenCalledTimes(3);
    expect(h.child.attribute.fireOnChange).not.toHaveBeenCalled();
    expect(h.data.save).not.toHaveBeenCalled();
    binding.dispose();
  });
  it.each(["scope", "offline", "generation", "record", "form", "data", "entity", "ui", "parent", "control", "attribute", "dispose"])(
    "does not apply pending filters after %s invalidation", async kind => {
      const h = host(), pending = deferred<string>();
      h.options.prepare = () => pending.promise;
      const binding = Lookups.bindDependent(h.form, h.options), old = binding.readiness;
      await Promise.resolve();
      if (kind === "scope") h.scope.userId = id(91);
      if (kind === "offline") h.scope.online = false;
      if (kind === "generation") Environment.invalidate(undefined, { context: h.context });
      if (kind === "record") h.state.record = id(71);
      if (kind === "form") h.state.form = id(81);
      if (kind === "data") Reflect.set(h.form, "data", { ...h.data });
      if (kind === "entity") Reflect.set(h.data, "entity", { ...h.data.entity });
      if (kind === "ui") Reflect.set(h.form, "ui", { ...h.form.ui });
      if (kind === "parent") h.attributes.set("parent", h.other.attribute);
      if (kind === "control") h.controls.set("child", h.other.control);
      if (kind === "attribute") h.child.value.boundAttribute = h.other.attribute;
      if (kind === "dispose") binding.dispose();
      pending.resolve(xml("stale"));
      expect(await old).toMatchObject({ status: "failed", error: { code: "CONFIG_EXPIRED" } });
      expect(h.child.control.addCustomFilter).not.toHaveBeenCalled();
      if (kind !== "dispose") {
        expect(() => h.child.search()).toThrow();
        expect(h.options.onError).toHaveBeenCalled();
        binding.dispose();
      }
    }
  );
  it("retains exact callback errors and simultaneous stale-scope evidence", async () => {
    const h = host(), pending = deferred<string>(), cause = new Error("Original private diagnostic");
    h.options.prepare = () => pending.promise;
    const binding = Lookups.bindDependent(h.form, h.options);
    await Promise.resolve();
    h.scope.languageId = 1043;
    pending.reject(cause);
    const result = await binding.readiness;
    expect(result).toMatchObject({ status: "failed", error: { code: "CONFIG_EXPIRED" } });
    if (result.status === "failed") expect(result.error.cause).toMatchObject({ error: cause, scope: expect.any(Error) });
    expect(h.options.onError).toHaveBeenCalledWith(expect.objectContaining({ error: result.status === "failed" ? result.error : null }));
    binding.dispose();
  });
  it.each(["throw", "reject", "invalid-filter", "sink-throw", "sink-async"])(
    "makes %s failures observable without unhandled rejections", async kind => {
      const h = host(), cause = new Error("Original"), sink = new Error("Sink");
      if (kind === "throw") h.options.prepare = () => { throw cause; };
      if (kind === "reject") h.options.prepare = () => Promise.reject(cause);
      if (kind === "invalid-filter") h.options.prepare = () => "<fetch/>";
      if (kind.startsWith("sink")) {
        h.options.prepare = () => { throw cause; };
        h.options.onError = kind === "sink-throw" ? () => { throw sink; } : () => Promise.reject(sink);
      }
      const binding = Lookups.bindDependent(h.form, h.options), result = await binding.readiness;
      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        if (kind.startsWith("sink")) expect(result.error).toMatchObject({
          code: "ERROR_PRESENTATION_FAILED", cause: { error: { cause } }
        });
        else if (kind !== "invalid-filter") expect(result.error.cause).toBe(cause);
      }
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(h.child.control.addCustomFilter).not.toHaveBeenCalled();
      binding.dispose();
    }
  );
  it("does not compare callbacks by JSON, rejects conflicts, self-dependencies and owned cycles", async () => {
    const h = host(), binding = Lookups.bindDependent(h.form, h.options);
    await binding.readiness;
    expect(() => Lookups.bindDependent(h.form, { ...h.options, prepare: () => xml() }))
      .toThrow(expect.objectContaining({ code: "RESOURCE_CONFLICT" }));
    expect(() => Lookups.bindDependent(h.form, { ...h.options, childControl: "parent" }))
      .toThrow(expect.objectContaining({ code: "EVENT_REENTRY" }));
    const second = Lookups.bindDependent(h.form, { ...h.options, parentColumn: "child", childControl: "other" });
    await second.readiness;
    expect(() => Lookups.bindDependent(h.form, { ...h.options, parentColumn: "other", childControl: "parent" }))
      .toThrow(expect.objectContaining({ code: "EVENT_REENTRY" }));
    second.dispose(); binding.dispose();
  });
  it("rejects event source/form replacement and wrong native lookup kind before any filter", async () => {
    const h = host(), binding = Lookups.bindDependent(h.form, h.options);
    await binding.readiness;
    const search = [...h.child.searches][0]!;
    expect(() => search(h.event(h.other.control))).toThrow(expect.objectContaining({ code: "CONFIG_EXPIRED" }));
    expect(() => search(h.event(h.child.control, { ...h.form }))).toThrow();
    h.child.value.controlType = "standard";
    expect(() => search(h.event(h.child.control))).toThrow();
    expect(h.child.control.addCustomFilter).not.toHaveBeenCalled();
    binding.dispose();
  });
  it("cleans every owned registration after an add mutates then throws", () => {
    const h = host(), foreign = vi.fn(), cause = new Error("after-add");
    h.parent.changes.add(foreign);
    h.data.addOnLoad.mockImplementationOnce(handler => { h.loads.add(handler); throw cause; });
    expect(() => Lookups.bindDependent(h.form, h.options)).toThrow(expect.objectContaining({ cause }));
    expect(h.parent.changes).toEqual(new Set([foreign]));
    expect(h.child.searches.size).toBe(0);
    expect(h.loads.size).toBe(0);
    expect(h.data.removeOnLoad).toHaveBeenCalledOnce();
    expect(h.parent.attribute.removeOnChange).toHaveBeenCalledOnce();
    expect(h.child.control.removePreSearch).toHaveBeenCalledOnce();
  });
  it("continues cleanup when a remover fails, blocks late work, and permits owned cleanup retry", async () => {
    const h = host(), binding = Lookups.bindDependent(h.form, h.options);
    await binding.readiness;
    h.data.removeOnLoad.mockImplementationOnce(() => { throw new Error("remove failed"); });
    expect(() => binding.dispose()).toThrow(expect.objectContaining({ code: "PARTIAL_FAILURE" }));
    expect(h.parent.changes.size).toBe(0); expect(h.child.searches.size).toBe(0);
    expect(binding.state).toMatchObject({ status: "not-ready", reason: "disposed" });
    expect(binding.dispose()).toEqual({ removed: true });
    expect(h.loads.size).toBe(0);
    expect(h.parent.attribute.removeOnChange).toHaveBeenCalledOnce();
  });
  it("bounds pending work to eight per binding, retains consent policy and releases capacity after drain", async () => {
    const h = host(), pending = deferred<string>();
    h.options.prepare = () => pending.promise;
    const binding = Lookups.bindDependent(h.form, h.options);
    const receipts = [binding.readiness];
    for (let n = 0; n < 7; n++) { await Promise.resolve(); receipts.push(binding.refresh()); }
    await Promise.resolve();
    expect(await binding.refresh()).toMatchObject({ status: "failed", error: { code: "LIMIT_EXCEEDED" } });
    pending.resolve(xml());
    await Promise.all(receipts);
    expect(await binding.refresh()).toMatchObject({ status: "ready" });
    binding.dispose();
  });
  it("copies trusted prepare arguments and handles a single-form selector's legitimate null identity", async () => {
    const h = host();
    h.state.currentItem = false;
    h.options.prepare = refs => { refs[0]!.id = id(30); return xml(); };
    const binding = Lookups.bindDependent(h.form, h.options);
    expect(await binding.readiness).toMatchObject({ parent: [ref()] });
    expect(h.parent.value.refs).toEqual([ref()]);
    binding.dispose();
  });
  it.each([
    { selectionOnInvalidate: undefined }, { selectionOnInvalidate: "automatic" }, { emptyParent: undefined },
    { ownerLookup: true }, { lookupKind: "owner" }, { parentTables: [] }, { parentTables: ["account", "ACCOUNT"] },
    { parentColumn: "bad name" }, { childControl: "" }, { prepare: "script" }, { onError: undefined }, { extra: true }
  ])("rejects unsafe binding contracts before registering anything: %j", patch => {
    const h = host();
    expect(() => Reflect.apply(Lookups.bindDependent, undefined, [h.form, { ...h.options, ...patch }])).toThrow();
    expect(h.child.control.addPreSearch).not.toHaveBeenCalled();
    expect(h.parent.attribute.addOnChange).not.toHaveBeenCalled();
    expect(h.data.addOnLoad).not.toHaveBeenCalled();
  });
  it.each(["wrong-type", "party", "wrong-target", "multi", "duplicate", "malformed"])(
    "rejects %s parent snapshots before registering", kind => {
      const h = host();
      if (kind === "wrong-type") h.parent.value.type = "string";
      if (kind === "party") h.parent.value.party = true;
      if (kind === "wrong-target") h.parent.value.refs = [{ ...ref(), entityType: "contact" }];
      if (kind === "multi") h.parent.value.refs = [ref(), ref(2)];
      if (kind === "duplicate") h.parent.value.refs = [ref(), ref()];
      if (kind === "malformed") h.parent.value.refs = [{ id: id() }];
      expect(() => Lookups.bindDependent(h.form, h.options)).toThrow();
      expect(h.child.control.addPreSearch).not.toHaveBeenCalled();
    }
  );
  it("reports ignored and throwing clears as unknown, without claiming rollback or losing selected refs", async () => {
    const h = host(), selected = h.child.value.refs;
    h.options.selectionOnInvalidate = "clear";
    h.child.attribute.setValue.mockImplementationOnce(() => undefined);
    const binding = Lookups.bindDependent(h.form, h.options);
    expect(await binding.readiness).toMatchObject({
      status: "failed", error: { code: "MUTATION_OUTCOME_UNKNOWN" }, selection: "unknown"
    });
    expect(h.child.value.refs).toBe(selected);
    const cause = new Error("Uncertain clear");
    h.child.attribute.setValue.mockImplementationOnce(() => { throw cause; });
    expect(await binding.refresh()).toMatchObject({
      status: "failed", error: { cause }, selection: "unknown"
    });
    binding.dispose();
  });
  it("rejects synchronous prepare and PreSearch reentry with observable errors instead of recursion", async () => {
    const h = host();
    h.options.prepare = () => { void binding.refresh(); return xml(); };
    const binding = Lookups.bindDependent(h.form, h.options);
    expect(await binding.readiness).toMatchObject({ status: "failed" });
    expect(h.options.onError).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: "EVENT_REENTRY" })
    }));
    binding.dispose();
    h.options.prepare = () => xml();
    const next = Lookups.bindDependent(h.form, h.options);
    await next.readiness;
    h.child.control.addCustomFilter.mockImplementationOnce(() => { h.child.search(); });
    expect(() => h.child.search()).toThrow(expect.objectContaining({ code: "EVENT_REENTRY" }));
    expect(next.state).toMatchObject({ status: "failed" });
    next.dispose();
  });
  it("retains a failed registration cleanup handle for retry, without removing foreign handlers", () => {
    const h = host(), cause = new Error("add failed"), removal = new Error("remove failed"), foreign = vi.fn();
    h.parent.changes.add(foreign);
    h.data.addOnLoad.mockImplementationOnce(handler => { h.loads.add(handler); throw cause; });
    h.data.removeOnLoad.mockImplementationOnce(() => { throw removal; });
    const error = thrown(() => Lookups.bindDependent(h.form, h.options));
    expect(error).toMatchObject({ code: "PARTIAL_FAILURE", cause: { error: { cause }, cleanup: expect.any(Error) } });
    const retained = error.cause;
    if (typeof retained !== "object" || retained === null || !("binding" in retained)) throw new Error("Missing cleanup handle");
    const binding = retained.binding;
    if (typeof binding !== "object" || binding === null || !("dispose" in binding) || typeof binding.dispose !== "function") {
      throw new Error("Invalid cleanup handle");
    }
    Reflect.apply(binding.dispose, binding, []);
    expect(h.loads.size).toBe(0);
    expect(h.parent.changes).toEqual(new Set([foreign]));
  });
  it("bounds registrations to 100 per form and admits a replacement after owned disposal", async () => {
    const h = host();
    h.parent.value.refs = null; // No pending loaders needed to exercise registration capacity.
    const tokens = [];
    for (let n = 0; n < 100; n++) {
      const name = `child${n}`; h.field(name);
      tokens.push(Lookups.bindDependent(h.form, { ...h.options, childControl: name }));
    }
    h.field("extra");
    expect(() => Lookups.bindDependent(h.form, { ...h.options, childControl: "extra" }))
      .toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
    tokens[0]!.dispose();
    const replacement = Lookups.bindDependent(h.form, { ...h.options, childControl: "extra" });
    expect(await replacement.readiness).toMatchObject({ status: "not-ready", reason: "parent-empty" });
    for (const token of tokens) token.dispose();
    replacement.dispose();
    expect(h.loads.size).toBe(0);
  });
  it("keeps a page-local 64 preparation cap until superseded/disposed work drains", async () => {
    const h = host(), pending = deferred<string>(), tokens = [];
    h.options.prepare = () => pending.promise;
    for (let n = 0; n < 8; n++) {
      const name = `child${n}`; h.field(name);
      const token = Lookups.bindDependent(h.form, { ...h.options, childControl: name });
      tokens.push(token);
      for (let j = 0; j < 7; j++) void token.refresh();
    }
    h.field("extra");
    const blocked = Lookups.bindDependent(h.form, { ...h.options, childControl: "extra" });
    expect(await blocked.readiness).toMatchObject({ status: "failed", error: { code: "LIMIT_EXCEEDED" } });
    const settled = tokens.map(token => token.readiness);
    for (const token of tokens) token.dispose();
    pending.resolve(xml());
    await Promise.all(settled);
    expect(await blocked.refresh()).toMatchObject({ status: "ready" });
    blocked.dispose();
  });
  it("reports native filter failure without replacing its original diagnostic with not-ready", async () => {
    const h = host(), error = new VbdError("OPERATION_FAILED", { operation: "test.native", cause: new Error("Native error") });
    const binding = Lookups.bindDependent(h.form, h.options);
    await binding.readiness;
    h.child.control.addCustomFilter.mockImplementationOnce(() => { throw error; });
    expect(thrown(() => h.child.search())).toBe(error);
    expect(thrown(() => h.child.search())).toBe(error);
    expect(binding.state).toMatchObject({ status: "failed", error });
    binding.dispose();
  });
});

describe("compiled browser lookup subset with cross-realm supplied native refs", () => {
  it("adds/reuses a view, prepares synchronously applied filters, validates copied refs and cleans owned handlers", async () => {
    const h = host(), bundle = readFileSync(resolve("dist", "vbd.toolkit.js"), "utf8");
    const serialized: unknown = await runInNewContext(`${bundle}
      (async () => {
        const receipt = VBD.Lookups.addView(form, "child", viewOptions);
        const existing = VBD.Lookups.addView(form, "child", viewOptions);
        const binding = VBD.Lookups.bindDependent(VBD.Context.fromFormCommand(form), bindingOptions);
        const ready = await binding.readiness;
        search();
        const validation = await VBD.Lookups.validateSelection(refs, {
          allowedTables:["account"],cardinality:{min:1,max:1},empty:"invalid",
          predicate:{mode:"async",test:async ref=>ref.entityType==="account"},
          access:{policy:"required",mode:"async",check:async ref=>({ref,status:"granted",basis:"caller-evidence"})},
          context:readContext
        });
        const disposed = binding.dispose();
        return JSON.stringify({receipt,existing,ready,validation,disposed});
      })()`, {
      crypto: globalThis.crypto, URL, TextEncoder, form: h.form, viewOptions: view(), bindingOptions: h.options,
      search: h.child.search, refs: [ref()], readContext: h.context
    }, { timeout: 5000 });
    if (typeof serialized !== "string") throw new Error("Expected serialized browser results");
    expect(JSON.parse(serialized)).toMatchObject({
      receipt: { status: "requested", removable: false }, existing: { status: "existing" },
      ready: { status: "ready", parent: [ref()] },
      validation: { status: "valid", records: [{ ref: ref(), predicate: "passed", access: "granted" }] },
      disposed: { removed: true }
    });
    expect(h.child.control.addCustomView).toHaveBeenCalledOnce();
    expect(h.child.control.addCustomFilter).toHaveBeenCalledExactlyOnceWith(xml(), "account");
    expect(h.parent.changes.size).toBe(0);
    expect(h.child.searches.size).toBe(0);
    expect(h.loads.size).toBe(0);
    expect(h.context.retrieveMultipleRecords).not.toHaveBeenCalled();
  });
});
