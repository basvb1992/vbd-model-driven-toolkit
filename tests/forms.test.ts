import { afterEach, describe, expect, it, vi } from "vitest";
import { Fields, Forms } from "../src/forms.js";
import { Controls, Layout } from "../src/controls.js";
import { Context } from "../src/context.js";
import { Utils } from "../src/utils.js";
import { Validation } from "../src/form-validation.js";
import type { ValidationRule } from "../src/form-validation.js";
import { nativeForm } from "./native-fixture.js";
import { appId } from "./environment-helpers.js";

afterEach(() => { vi.restoreAllMocks(); });

describe("typed field changes", () => {
  it("preserves false, zero, null and clones dates without implicit events or save", () => {
    const host = nativeForm();
    expect(Fields.get(host.form, "enabled", "boolean")).toBe(false);
    expect(Fields.get(host.form, "number", "number")).toBe(0);
    expect(Fields.get(host.form, "name", "text")).toBeNull();
    const date = Fields.get(host.form, "date", "date");
    date?.setUTCFullYear(2000);
    expect(Fields.get(host.form, "date", "date")?.getUTCFullYear()).toBe(2026);
    Fields.set(host.form, "enabled", true);
    Fields.set(host.form, "number", 0);
    expect(host.field("enabled").attribute.fireOnChange).not.toHaveBeenCalled();
    expect(host.form.data.save).not.toHaveBeenCalled();
    expect(host.field("enabled").data.submit).toBe("dirty");
  });

  it.each([
    ["enabled", "false"], ["number", "12"], ["number", 1.5], ["date", "2026-10-28"],
    ["name", 42], ["choices", [1, 1]]
  ])("rejects a wrong native value type for %s", (column, value) => {
    const host = nativeForm();
    expect(() => Fields.set(host.form, String(column), value)).toThrow();
    expect(host.field(String(column)).attribute.setValue).not.toHaveBeenCalled();
  });

  it("rejects missing targets and wrong getter types rather than defaulting", () => {
    const host = nativeForm();
    expect(() => Fields.get(host.form, "absent")).toThrow(expect.objectContaining({
      code: "FORM_TARGET_MISSING", cause: { kind: "attribute", target: "absent" }
    }));
    expect(() => Fields.get(host.form, "enabled", "number")).toThrow(expect.objectContaining({ code: "FIELD_TYPE_MISMATCH" }));
    host.field("name").data.type = "file";
    expect(() => Fields.get(host.form, "name")).toThrow(expect.objectContaining({ code: "UNSUPPORTED_SURFACE" }));
  });

  it("changes required/submit modes explicitly and dispatches changes only on request", () => {
    const host = nativeForm();
    Fields.setRequired(host.form, ["name", "number"], "required");
    Fields.setSubmitMode(host.form, "name", "always");
    Fields.set(host.form, "name", "configured", { fireOnChange: true, submitMode: "never" });
    expect(host.field("name").data).toMatchObject({ required: "required", submit: "never" });
    expect(host.field("number").data.required).toBe("required");
    expect(host.field("name").attribute.fireOnChange).toHaveBeenCalledOnce();
    expect(() => Fields.setRequired(host.form, ["name", "name"], "none")).toThrow();
  });

  it("preflights all targets and snapshots copies before writing", () => {
    const host = nativeForm({
      first: { type: "string", value: "A" }, second: { type: "string", value: "B" }
    });
    expect(() => Fields.clear(host.form, ["first", "missing"])).toThrow();
    expect(host.field("first").attribute.setValue).not.toHaveBeenCalled();
    const result = Fields.copy(host.form, [{ from: "first", to: "second" }, { from: "second", to: "first" }], { overwrite: true });
    expect(result.applied).toEqual(["second", "first"]);
    expect(Fields.get(host.form, "first")).toBe("B");
    expect(Fields.get(host.form, "second")).toBe("A");
    Fields.clear(host.form, ["first", "second"]);
    expect(Fields.get(host.form, "first")).toBeNull();
  });

  it("preserves existing zero/false/defaults and reports policy skips explicitly", () => {
    const host = nativeForm();
    expect(Fields.setDefault(host.form, "enabled", true).status).toBe("skipped");
    expect(Fields.setDefault(host.form, "number", 2).status).toBe("skipped");
    expect(Fields.setDefault(host.form, "name", "default").status).toBe("applied");
    expect(Fields.copy(host.form, [{ from: "name", to: "name" }])).toEqual({ applied: [], skipped: ["name"] });
    host.field("name").data.value = "";
    expect(Fields.setDefault(host.form, "name", "new").status).toBe("skipped");
    expect(Fields.setDefault(host.form, "name", "new", { emptyString: true }).status).toBe("applied");
    expect(() => Fields.setDefault(host.form, "enabled", "invalid")).toThrow();
  });

  it("surfaces partial mutations and prevents recursive dispatch", () => {
    const host = nativeForm({
      first: { type: "string", value: "A" }, second: { type: "string", value: "B" }
    });
    host.field("second").attribute.setValue.mockImplementation(() => { throw new Error("NATIVE_CANARY"); });
    expect(() => Fields.clear(host.form, ["first", "second"]))
      .toThrow(expect.objectContaining({ code: "PARTIAL_FAILURE" }));
    expect(Fields.get(host.form, "first")).toBeNull();
    host.field("first").handlers.add(() => Fields.fireOnChange(host.form, "first"));
    expect(() => Fields.fireOnChange(host.form, "first")).toThrow(expect.objectContaining({ code: "EVENT_REENTRY" }));
    host.field("first").handlers.clear();
    expect(Fields.fireOnChange(host.form, "first")).toEqual({ dispatched: true });
    host.field("first").attribute.setSubmitMode.mockImplementation(() => { throw new Error("SUBMIT_CANARY"); });
    expect(() => Fields.set(host.form, "first", "changed", { submitMode: "always" }))
      .toThrow(expect.objectContaining({ code: "PARTIAL_FAILURE" }));
  });

  it("normalizes lookup IDs, enforces labels/targets/cardinality, and keeps choice identity", () => {
    const host = nativeForm();
    Fields.setLookup(host.form, "lookup", [{ entityType: "account", id: appId, name: "Fixture" }]);
    expect(host.field("lookup").data.value).toEqual([{ entityType: "account", id: `{${appId}}`, name: "Fixture" }]);
    expect(Fields.getLookup(host.form, "lookup")).toEqual([{ entityType: "account", id: appId, name: "Fixture" }]);
    expect(() => Fields.setLookup(host.form, "lookup", [{ entityType: "account", id: appId }])).toThrow();
    expect(() => Fields.setLookup(host.form, "lookup", [{ entityType: "unsupported", id: appId, name: "Fixture" }])).toThrow();
    const second = { entityType: "contact", id: crypto.randomUUID(), name: "Second" };
    expect(() => Fields.setLookup(host.form, "lookup", [{ entityType: "account", id: appId, name: "Fixture" }, second])).toThrow();
    host.field("lookup").data.partyList = true;
    Fields.setLookup(host.form, "lookup", [{ entityType: "account", id: appId, name: "Fixture" }, second]);
    expect(Fields.getLookup(host.form, "lookup")).toHaveLength(2);
    Fields.setLookup(host.form, "lookup", null);
    Fields.set(host.form, "choices", [2, 1]);
    expect(Fields.get(host.form, "choices", "choices")).toEqual([2, 1]);
  });

  it("accepts 100 field targets and rejects 101 before changes", () => {
    const initial = Object.fromEntries(Array.from({ length: 101 }, (_, index) =>
      [`field${index}`, { type: "string", value: "value" }]));
    const host = nativeForm(initial);
    expect(Fields.clear(host.form, Object.keys(initial).slice(0, 100))).toHaveLength(100);
    host.field("field0").attribute.setValue.mockClear();
    expect(() => Fields.clear(host.form, Object.keys(initial))).toThrow();
    expect(host.field("field0").attribute.setValue).not.toHaveBeenCalled();
  });
});

describe("control/layout consistency and dirty safety", () => {
  it("updates every bound control unless a specific named control is requested", () => {
    const host = nativeForm();
    expect(Controls.setVisible(host.form, "name", false)).toHaveLength(2);
    expect(host.field("name").body.state.visible).toBe(false);
    expect(host.field("name").header.state.visible).toBe(false);
    Controls.setVisible(host.form, "name", true, { scope: "control" });
    expect(host.field("name").header.state.visible).toBe(false);
    Controls.setDisabled(host.form, "name", true);
    Controls.setLabel(host.form, "name", "Configured label");
    expect(host.field("name").body.state).toMatchObject({ disabled: true, label: "Configured label" });
    expect(Controls.forAttribute(host.form, "name", control => control.getName)).toHaveLength(2);
    expect(() => Controls.setFocus(host.form, "name")).toThrow();
    Controls.setDisabled(host.form, "name", false);
    Controls.setFocus(host.form, "name");
    expect(host.field("name").body.control.setFocus).toHaveBeenCalledOnce();
  });

  it("does not partially change controls when a later target is missing", () => {
    const host = nativeForm();
    expect(() => Controls.setDisabled(host.form, ["name", "absent"], true)).toThrow();
    expect(host.field("name").body.control.setDisabled).not.toHaveBeenCalled();
    host.field("name").header.control.setVisible.mockImplementation(() => { throw new Error("CONTROL_CANARY"); });
    expect(() => Controls.setVisible(host.form, "name", false))
      .toThrow(expect.objectContaining({ code: "PARTIAL_FAILURE" }));
  });

  it("handles named tabs/sections/focus and rejects missing or duplicate layout targets", () => {
    const host = nativeForm();
    Layout.setTabVisible(host.form, "tab", false);
    expect(() => Layout.focusTab(host.form, "tab")).toThrow();
    Layout.setTabVisible(host.form, "tab", true);
    Layout.setTabExpanded(host.form, "tab", true);
    Layout.setSectionVisible(host.form, [{ tab: "tab", section: "section" }], false);
    Layout.focusTab(host.form, "tab");
    expect(host.tabState).toMatchObject({ visible: true, display: "expanded" });
    expect(host.sectionState.visible).toBe(false);
    expect(host.tab.setFocus).toHaveBeenCalledOnce();
    expect(() => Layout.setTabVisible(host.form, ["tab", "tab"], true)).toThrow();
    expect(() => Layout.setSectionVisible(host.form, [{ tab: "tab", section: "missing" }], true)).toThrow();
    expect(() => Layout.setTabExpanded(host.form, "missing", false)).toThrow();
  });

  it("does not save/discard dirty forms implicitly and checks for new edits after saving", async () => {
    const host = nativeForm();
    host.state.dirty = true;
    await expect(Forms.refresh(host.form)).rejects.toMatchObject({ code: "DIRTY_FORM" });
    expect(host.form.data.save).not.toHaveBeenCalled();
    expect(host.form.data.refresh).not.toHaveBeenCalled();
    await Forms.refresh(host.form, { dirtyPolicy: "save" });
    expect(host.form.data.save).toHaveBeenCalledOnce();
    expect(host.form.data.refresh).toHaveBeenCalledWith(false);
    host.state.dirty = true;
    host.form.data.save.mockImplementation(async () => { host.state.dirty = true; });
    await expect(Forms.refresh(host.form, { dirtyPolicy: "save" })).rejects.toMatchObject({ code: "DIRTY_FORM" });
    expect(host.form.data.refresh).toHaveBeenCalledTimes(1);
    expect(Forms.getType(host.form)).toBe(2);
    expect(Forms.isDirty(host.form)).toBe(true);
  });

  it("blocks reentrant saves and keeps native failures explicit", async () => {
    const host = nativeForm();
    let release = (): void => {};
    host.form.data.save.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const pending = Forms.save(host.form, { saveMode: 1 });
    await expect(Forms.save(host.form)).rejects.toMatchObject({ code: "EVENT_REENTRY" });
    release();
    await expect(pending).resolves.toEqual({ status: "saved" });
    host.form.data.save.mockRejectedValueOnce(new Error("SAVE_CANARY"));
    await expect(Forms.save(host.form)).rejects.toMatchObject({ code: "SDK_OPERATION_FAILED" });
  });

  it("namespaces form notifications and never clears an unrelated native ID", () => {
    const host = nativeForm();
    host.notifications.set("other", { message: "Other", level: "INFO" });
    Forms.setNotification(host.form, "mine", "Configured", "WARNING");
    expect(host.notifications.has("vbd_toolkit_mine")).toBe(true);
    expect(Forms.clearNotification(host.form, "mine")).toEqual({ removed: true });
    expect(Forms.clearNotification(host.form, "mine")).toEqual({ removed: false });
    expect(host.notifications.has("other")).toBe(true);
    host.form.ui.setFormNotification.mockReturnValueOnce(false);
    expect(() => Forms.setNotification(host.form, "mine", "Message", "INFO")).toThrow();
  });
});

describe("bounded synchronous validation", () => {
  const required: ValidationRule = { id: "required", kind: "required", field: "name" };
  it("preserves false/zero, rejects blank text, and never returns field payloads in issues", () => {
    expect(Validation.evaluate([
      { id: "flag", kind: "required", field: "enabled" },
      { id: "zero", kind: "required", field: "number" }
    ], { enabled: false, number: 0 }).valid).toBe(true);
    expect(Validation.evaluate([required], { name: "   " }).valid).toBe(false);
    const result = Validation.evaluate([{ id: "length", field: "name", kind: "length", min: 100 }], { name: "VALUE_CANARY" });
    expect(result.valid).toBe(false);
    expect(JSON.stringify(result)).not.toContain("VALUE_CANARY");
  });

  it("checks range, length, references, formats, and explicit JSON rules", () => {
    expect(Validation.evaluate([
      { id: "range", field: "number", kind: "range", min: 0, max: 0 },
      { id: "length", field: "name", kind: "length", min: 1, max: 4 },
      { id: "eq", field: "enabled", kind: "equals", expected: false },
      { id: "email", field: "email", kind: "format", format: "email" },
      { id: "url", field: "url", kind: "format", format: "httpsUrl" },
      { id: "guid", field: "id", kind: "format", format: "guid" }
    ], { number: 0, name: "Test", enabled: false, email: "fixture@example.test", url: "https://example.test/path", id: appId }).valid).toBe(true);
    expect(Validation.evaluate(JSON.stringify([required]), { name: "valid" }).valid).toBe(true);
    expect(() => Reflect.apply(Validation.evaluate, undefined, [[{ ...required, kind: "regex" }], {}])).toThrow();
    expect(() => Validation.evaluate([required, required], {})).toThrow();
    expect(() => Validation.evaluate([{ id: "bad", field: "number", kind: "range", min: 2, max: 1 }], {})).toThrow();
  });

  it("blocks saves synchronously and clears only its notification after correction", () => {
    const host = nativeForm();
    expect(Validation.validateBeforeSave(host.execution, [required])).toMatchObject({ valid: false, prevented: true });
    expect(host.args.preventDefault).toHaveBeenCalledOnce();
    expect(host.notifications.has("vbd_toolkit_validation")).toBe(true);
    Fields.set(host.form, "name", "Corrected");
    expect(Validation.validateFields(host.form, [required]).valid).toBe(true);
    expect(host.notifications.has("vbd_toolkit_validation")).toBe(false);
    expect(host.form.data.save).not.toHaveBeenCalled();
    expect(() => Validation.validateBeforeSave(host.execution, [{ ...required, field: "missing" }])).toThrow();
    expect(host.args.preventDefault).toHaveBeenCalledTimes(2);
  });

  it("accepts 200 rules but rejects 201 and more than 100 native field reads", () => {
    const rules: ValidationRule[] = Array.from({ length: 200 }, (_, index) => ({
      id: `rule${index}`, field: "name", kind: "required"
    }));
    expect(Validation.evaluate(rules, { name: "valid" }).valid).toBe(true);
    expect(() => Validation.evaluate([...rules, { id: "over", field: "name", kind: "required" }], {})).toThrow();
    const host = nativeForm();
    const many: ValidationRule[] = Array.from({ length: 101 }, (_, index) => ({
      id: `field${index}`, field: `field${index}`, kind: "required"
    }));
    expect(() => Validation.validateFields(host.form, many)).toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
    expect(host.form.getAttribute).not.toHaveBeenCalled();
  });
});

describe("context and scalar helpers", () => {
  it("does not mistake create, bulk or undefined form contexts for a saved record", () => {
    const host = nativeForm();
    const context = Context.fromFormEvent(host.execution);
    expect(Context.requireSavedRecord(context)).toEqual({ entityType: "account", id: appId });
    host.state.type = 1;
    expect(Context.getRecord(context).state).toBe("unsaved");
    expect(() => Context.requireSavedRecord(context)).toThrow(expect.objectContaining({ code: "UNSAVED_RECORD" }));
    host.state.type = 6;
    expect(Context.getRecord(context).state).toBe("none");
    host.state.type = 0;
    expect(Context.getRecord(context).state).toBe("none");
  });

  it("escapes scalar literals/JSON-independent XML and compares typed values without coercion", () => {
    expect(Utils.normalizeGuid(`{${appId.toUpperCase()}}`)).toBe(appId);
    expect(Utils.isGuid("bad")).toBe(false);
    expect(Utils.toEntityRef("ACCOUNT", `{${appId}}`)).toEqual({ entityType: "account", id: appId });
    expect(Utils.escapeODataLiteral("O'Brien", "string")).toBe("'O''Brien'");
    expect(Utils.escapeODataLiteral(false, "boolean")).toBe("false");
    expect(Utils.escapeODataLiteral(0, "number")).toBe("0");
    expect(Utils.escapeODataLiteral(null, "string")).toBe("null");
    expect(Utils.escapeXml(`<&"'`)).toBe("&lt;&amp;&quot;&apos;");
    expect(() => Utils.escapeXml("\u0000")).toThrow();
    expect(() => Utils.escapeODataLiteral("\ud800", "string")).toThrow();
    expect(Utils.parseNumber("1e2", { min: 100, max: 100 })).toBe(100);
    expect(() => Utils.parseNumber("0x10")).toThrow();
    expect(Utils.compareValues(0, "0", "eq")).toBe(false);
    expect(Utils.compareValues([2, 1], [1, 2], "eq")).toBe(true);
    expect(Utils.compareValues([], null, "eq")).toBe(false);
    expect(Utils.compareValues("abc", "b", "contains")).toBe(true);
    expect(Utils.compareValues(2, [1, 2], "in")).toBe(true);
    expect(Utils.compareValues(null, 2, "gt")).toBe(false);
    expect(Utils.compareValues(new Date(1), new Date(0), "gt")).toBe(true);
    expect(() => Utils.compareValues({}, {}, "eq")).toThrow();
  });
});
