import { afterEach, describe, expect, it, vi } from "vitest";
import { Forms } from "../src/forms.js";
import { Context } from "../src/context.js";
import type { SdkObject } from "../src/sdk.js";

// Synthetic fixture IDs; never resolved against an environment.
const currentId = "11111111-1111-1111-1111-111111111111";
const targetId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const recordId = "33333333-3333-3333-3333-333333333333";
function item(id: string) {
  const native = {
    getId: vi.fn(function(this: unknown): string { expect(this).toBe(native); return id; }),
    navigate: vi.fn(function(this: unknown): void { expect(this).toBe(native); })
  };
  return native;
}
function switchHost() {
  const current = item(currentId), target = item(targetId);
  const state = {
    dirty: false, type: 2, id: recordId, table: "account", client: "Web", factor: 1,
    current: current as SdkObject | null, items: [current, target] as SdkObject[]
  };
  const entity = {
    getId: vi.fn(function(this: unknown): string { expect(this).toBe(entity); return state.id; }),
    getEntityName: vi.fn(function(this: unknown): string { expect(this).toBe(entity); return state.table; })
  };
  const data = {
    entity,
    getIsDirty: vi.fn(function(this: unknown): boolean { expect(this).toBe(data); return state.dirty; }),
    save: vi.fn(async function(this: unknown): Promise<void> { expect(this).toBe(data); state.dirty = false; })
  };
  const items = {
    get: vi.fn(function(this: unknown): SdkObject[] { expect(this).toBe(items); return state.items; })
  };
  const selector = {
    items, getCurrentItem: vi.fn(function(this: unknown): SdkObject | null {
      expect(this).toBe(selector); return state.current;
    })
  };
  const ui = {
    formSelector: selector,
    getFormType: vi.fn(function(this: unknown): number { expect(this).toBe(ui); return state.type; })
  };
  const form = { getAttribute: vi.fn(), getControl: vi.fn(), data, ui };
  const client = {
    getClient: vi.fn(function(this: unknown): string { expect(this).toBe(client); return state.client; }),
    getFormFactor: vi.fn(function(this: unknown): number { expect(this).toBe(client); return state.factor; })
  };
  const utility = {
    getGlobalContext: vi.fn(function(this: unknown): SdkObject { expect(this).toBe(utility); return { client }; })
  };
  vi.stubGlobal("Xrm", { Utility: utility });
  return { state, form, data, ui, selector, current, target, items, entity, client };
}
afterEach(() => { vi.unstubAllGlobals(); });

describe("R2 bounded native form switching", () => {
  it("uses only supplied permitted selector items with bound receivers and reports a request, not completion", async () => {
    const host = switchHost();
    const context = Context.fromFormCommand(host.form);
    await expect(Forms.switchForm(context, `{${targetId.toUpperCase()}}`))
      .resolves.toEqual({ status: "requested", formId: targetId });
    expect(host.target.navigate).toHaveBeenCalledExactlyOnceWith();
    expect(host.data.save).not.toHaveBeenCalled();
    expect(host.state.current).toBe(host.current);
  });

  it("returns alreadyCurrent distinctly without native navigate/save, including dirty forms", async () => {
    const host = switchHost(); host.state.dirty = true;
    await expect(Forms.switchForm(host.form, currentId, { dirtyPolicy: "save" }))
      .resolves.toEqual({ status: "alreadyCurrent", formId: currentId });
    expect(host.target.navigate).not.toHaveBeenCalled();
    expect(host.current.navigate).not.toHaveBeenCalled();
    expect(host.data.save).not.toHaveBeenCalled();
    expect(host.state.dirty).toBe(true);
  });

  it.each(["", "bad", "{}",
    "{aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", " aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "a".repeat(8192), null, false])("rejects malformed/unbounded IDs: %j", async id => {
    const host = switchHost();
    await expect(Reflect.apply(Forms.switchForm, undefined, [host.form, id])).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(host.selector.getCurrentItem).not.toHaveBeenCalled();
    expect(host.target.navigate).not.toHaveBeenCalled();
  });

  it.each([{ dirtyPolicy: "discard" }, { dirty: false }, { useQuickCreateForm: true }, { saveMode: 1 }])(
    "rejects unsupported navigation/dirty flags: %j", async settings => {
      const host = switchHost();
      await expect(Reflect.apply(Forms.switchForm, undefined, [host.form, targetId, settings]))
        .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      expect(host.target.navigate).not.toHaveBeenCalled();
      expect(host.data.save).not.toHaveBeenCalled();
    });

  it.each([undefined, null, {}, { getFormContext: () => ({}) }, { surface: "formCommand", form: {}, selection: [] }])(
    "requires a native form or toolkit-owned OperationContext: %j", async input => {
      const host = switchHost();
      await expect(Forms.switchForm(input, targetId)).rejects.toMatchObject({ code: "UNSUPPORTED_SURFACE" });
      expect(host.target.navigate).not.toHaveBeenCalled();
    });

  it.each([0, 1, 3, 4, 6])("rejects unsupported/create/QuickCreate/bulk form type %s", async type => {
    const host = switchHost(); host.state.type = type;
    await expect(Forms.switchForm(host.form, targetId, { dirtyPolicy: "save" }))
      .rejects.toMatchObject({ code: "UNSUPPORTED_SURFACE" });
    expect(host.target.navigate).not.toHaveBeenCalled();
    expect(host.data.save).not.toHaveBeenCalled();
  });

  it.each([["Mobile", 1], ["Web", 2], ["Web", 3], ["Outlook", 1]])(
    "rejects unsupported client %s / form factor %s", async (client, factor) => {
      const host = switchHost(); host.state.client = client; host.state.factor = factor;
      await expect(Forms.switchForm(host.form, targetId)).rejects.toMatchObject({ code: "UNSUPPORTED_SURFACE" });
      expect(host.target.navigate).not.toHaveBeenCalled();
    });

  it.each(["", "{}"])("rejects unsaved update records: %j", async id => {
    const host = switchHost(); host.state.id = id;
    await expect(Forms.switchForm(host.form, targetId)).rejects.toMatchObject({ code: "UNSAVED_RECORD" });
    expect(host.target.navigate).not.toHaveBeenCalled();
  });

  it.each(["selector", "items", "getCurrentItem", "navigate", "getId", "getIsDirty"])(
    "preflights missing native %s before save/navigation", async missing => {
      const host = switchHost(); host.state.dirty = true;
      if (missing === "selector") Reflect.deleteProperty(host.ui, "formSelector");
      if (missing === "items") Reflect.deleteProperty(host.selector, "items");
      if (missing === "getCurrentItem") Reflect.deleteProperty(host.selector, "getCurrentItem");
      if (missing === "navigate") Reflect.deleteProperty(host.target, "navigate");
      if (missing === "getId") Reflect.deleteProperty(host.target, "getId");
      if (missing === "getIsDirty") Reflect.deleteProperty(host.data, "getIsDirty");
      await expect(Forms.switchForm(host.form, targetId, { dirtyPolicy: "save" }))
        .rejects.toMatchObject({ code: "UNSUPPORTED_SURFACE" });
      expect(host.data.save).not.toHaveBeenCalled();
    });

  it("rejects inaccessible/missing targets without role/access guessing", async () => {
    const host = switchHost(); host.state.items = [host.current];
    await expect(Forms.switchForm(host.form, targetId)).rejects.toMatchObject({ code: "FORM_TARGET_MISSING" });
    expect(host.target.navigate).not.toHaveBeenCalled();
  });

  it.each(["null", "foreign", "badId", "duplicateCurrent", "duplicateTarget", "duplicateObject"])(
    "rejects missing/ambiguous/inconsistent current or target items: %s", async scenario => {
      const host = switchHost();
      if (scenario === "null") host.state.current = null;
      if (scenario === "foreign") host.state.current = item(currentId);
      if (scenario === "badId") host.current.getId.mockReturnValue("not-a-guid");
      if (scenario === "duplicateCurrent") host.state.items.push(item(`{${currentId}}`));
      if (scenario === "duplicateTarget") host.state.items.push(item(`{${targetId.toUpperCase()}}`));
      if (scenario === "duplicateObject") host.state.items.push(host.target);
      await expect(Forms.switchForm(host.form, targetId)).rejects.toHaveProperty("code",
        scenario === "null" ? "UNSUPPORTED_SURFACE" : "DATA_RESPONSE_INVALID");
      expect(host.target.navigate).not.toHaveBeenCalled();
      expect(host.current.navigate).not.toHaveBeenCalled();
    });

  it("bounds selector enumeration to 100 and rejects 101 before native navigation", async () => {
    const host = switchHost();
    host.state.items.push(...Array.from({ length: 98 }, () => item(crypto.randomUUID())));
    await expect(Forms.switchForm(host.form, targetId)).resolves.toHaveProperty("status", "requested");
    host.target.navigate.mockClear();
    host.state.items.push(item(crypto.randomUUID()));
    await expect(Forms.switchForm(host.form, targetId)).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect(host.target.navigate).not.toHaveBeenCalled();
  });

  it("rejects dirty by default, then explicitly awaits Forms.save before navigation", async () => {
    const host = switchHost(); host.state.dirty = true;
    await expect(Forms.switchForm(host.form, targetId)).rejects.toMatchObject({ code: "DIRTY_FORM" });
    expect(host.data.save).not.toHaveBeenCalled();
    expect(host.target.navigate).not.toHaveBeenCalled();
    let release = (): void => {};
    host.data.save.mockImplementation(() => new Promise<void>(resolve => {
      release = () => { host.state.dirty = false; resolve(); };
    }));
    const pending = Forms.switchForm(host.form, targetId, { dirtyPolicy: "save" });
    expect(host.data.save).toHaveBeenCalledExactlyOnceWith({});
    expect(host.target.navigate).not.toHaveBeenCalled();
    release();
    await expect(pending).resolves.toHaveProperty("status", "requested");
    expect(host.target.navigate).toHaveBeenCalledOnce();
  });

  it("does not save a clean form just because save policy is permitted", async () => {
    const host = switchHost();
    await Forms.switchForm(host.form, targetId, { dirtyPolicy: "save" });
    expect(host.data.save).not.toHaveBeenCalled();
  });

  it("rejects new dirty edits after save without navigating or saving twice", async () => {
    const host = switchHost(); host.state.dirty = true;
    host.data.save.mockImplementation(async () => { host.state.dirty = true; });
    await expect(Forms.switchForm(host.form, targetId, { dirtyPolicy: "save" })).rejects.toMatchObject({ code: "DIRTY_FORM" });
    expect(host.data.save).toHaveBeenCalledOnce();
    expect(host.target.navigate).not.toHaveBeenCalled();
  });

  it.each(["record", "table", "currentId", "currentObject", "targetObject", "targetId", "targetMethod",
    "targetRemoved", "data", "entity", "ui", "selector", "items", "type", "client",
    "formMethods", "recordMethods", "dirtyMethod", "currentMethod"])(
    "rechecks native lifecycle/identity after await: %s", async race => {
      const host = switchHost(); host.state.dirty = true;
      host.data.save.mockImplementation(async () => {
        host.state.dirty = false;
        if (race === "record") host.state.id = crypto.randomUUID();
        if (race === "table") host.state.table = "contact";
        if (race === "currentId") host.current.getId.mockReturnValue(crypto.randomUUID());
        if (race === "currentObject") {
          const replacement = item(currentId); host.state.current = replacement; host.state.items[0] = replacement;
        }
        if (race === "targetObject") host.state.items[1] = item(targetId);
        if (race === "targetId") host.target.getId.mockReturnValue(crypto.randomUUID());
        if (race === "targetMethod") host.target.navigate = vi.fn();
        if (race === "targetRemoved") host.state.items = [host.current];
        if (race === "data") host.form.data = { ...host.data };
        if (race === "entity") host.data.entity = { ...host.entity };
        if (race === "ui") host.form.ui = { ...host.ui };
        if (race === "selector") host.ui.formSelector = { ...host.selector };
        if (race === "items") host.selector.items = { ...host.items };
        if (race === "type") host.state.type = 1;
        if (race === "client") host.state.client = "Mobile";
        if (race === "formMethods") host.form.getControl = vi.fn();
        if (race === "recordMethods") host.entity.getId = vi.fn(() => recordId);
        if (race === "dirtyMethod") host.data.getIsDirty = vi.fn(() => false);
        if (race === "currentMethod") host.current.getId = vi.fn(() => currentId);
      });
      await expect(Forms.switchForm(Context.fromFormEvent({ getFormContext: () => host.form }), targetId, { dirtyPolicy: "save" }))
        .rejects.toHaveProperty("code");
      expect(host.target.navigate).not.toHaveBeenCalled();
      expect(host.current.navigate).not.toHaveBeenCalled();
    });

  it("accepts normalized equivalent record/form IDs after save", async () => {
    const host = switchHost(); host.state.dirty = true;
    host.data.save.mockImplementation(async () => {
      host.state.dirty = false;
      host.state.id = `{${recordId.toUpperCase()}}`;
      host.current.getId.mockReturnValue(`{${currentId.toUpperCase()}}`);
      host.target.getId.mockReturnValue(`{${targetId.toUpperCase()}}`);
    });
    await expect(Forms.switchForm(host.form, targetId, { dirtyPolicy: "save" })).resolves.toHaveProperty("status", "requested");
  });

  it("blocks concurrent switch requests (including already-current) and releases after success", async () => {
    const host = switchHost(); host.state.dirty = true;
    let release = (): void => {};
    host.data.save.mockImplementation(() => new Promise<void>(resolve => {
      release = () => { host.state.dirty = false; resolve(); };
    }));
    const pending = Forms.switchForm(host.form, targetId, { dirtyPolicy: "save" });
    await expect(Forms.switchForm(host.form, targetId)).rejects.toMatchObject({ code: "RESOURCE_BUSY" });
    await expect(Forms.switchForm(host.form, currentId)).rejects.toMatchObject({ code: "RESOURCE_BUSY" });
    release(); await pending;
    await expect(Forms.switchForm(host.form, currentId)).resolves.toHaveProperty("status", "alreadyCurrent");
  });

  it("blocks reentry from the native navigate receiver", async () => {
    const host = switchHost();
    let reentry: Promise<unknown> | undefined;
    host.target.navigate.mockImplementation(() => { reentry = Forms.switchForm(host.form, targetId); });
    await Forms.switchForm(host.form, targetId);
    await expect(reentry).rejects.toMatchObject({ code: "RESOURCE_BUSY" });
    await expect(Forms.switchForm(host.form, currentId)).resolves.toHaveProperty("status", "alreadyCurrent");
  });

  it.each(["save", "navigate", "read"])("retains native %s failures and always releases the switch guard", async scenario => {
    const host = switchHost();
    if (scenario === "save") { host.state.dirty = true; host.data.save.mockRejectedValueOnce(new Error("SAVE_CANARY")); }
    if (scenario === "navigate") host.target.navigate.mockImplementationOnce(() => { throw new Error("NAVIGATE_CANARY"); });
    if (scenario === "read") host.selector.getCurrentItem.mockImplementationOnce(() => { throw new Error("READ_CANARY"); });
    await expect(Forms.switchForm(host.form, targetId, { dirtyPolicy: "save" }))
      .rejects.toMatchObject({ code: "SDK_OPERATION_FAILED" });
    host.state.dirty = false;
    await expect(Forms.switchForm(host.form, targetId)).resolves.toHaveProperty("status", "requested");
  });

  it("uses the existing Forms.save guard instead of bypassing an ongoing save", async () => {
    const host = switchHost(); host.state.dirty = true;
    let release = (): void => {};
    host.data.save.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const saving = Forms.save(host.form);
    await expect(Forms.switchForm(host.form, targetId, { dirtyPolicy: "save" })).rejects.toMatchObject({ code: "EVENT_REENTRY" });
    expect(host.target.navigate).not.toHaveBeenCalled();
    release(); await saving;
    host.state.dirty = false;
    await expect(Forms.switchForm(host.form, targetId)).resolves.toHaveProperty("status", "requested");
  });
});
