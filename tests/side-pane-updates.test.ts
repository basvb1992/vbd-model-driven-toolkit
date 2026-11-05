import { afterEach, describe, expect, it, vi } from "vitest";
import { SidePanes } from "../src/side-panes.js";
import type { SidePaneOptions } from "../src/side-panes.js";
import { nativeSdk } from "./native-fixture.js";
afterEach(() => vi.unstubAllGlobals());
const options = { paneId: "vbd_update", title: "Original" };
function fixture() {
  const sdk = nativeSdk(), panes = new Map<string, ReturnType<typeof makePane>>();
  function makePane(input: SidePaneOptions) {
    return {
      ...input, width: input.width ?? 400, canClose: input.canClose ?? true, hidden: false,
      navigate: vi.fn(async (_page: unknown) => { void _page; }),
      select: vi.fn(), close: vi.fn(() => { panes.delete(input.paneId); })
    };
  }
  const host = {
    getPane: vi.fn((id: string) => panes.get(id)),
    createPane: vi.fn(async (input: SidePaneOptions): Promise<unknown> => {
      const pane = makePane(input); panes.set(input.paneId, pane); return pane;
    })
  };
  const xrm = { ...sdk.xrm, App: { ...sdk.app, sidePanes: host } };
  vi.stubGlobal("Xrm", xrm);
  return { ...sdk, xrm, host, panes, makePane };
}
function paneOf(f: ReturnType<typeof fixture>) {
  const pane = f.panes.get(options.paneId);
  if (!pane) throw new Error("Missing native test pane.");
  return pane;
}
describe("owned native side-pane property updates", () => {
  it("applies deterministic supported changes and reuses the same owned token with current options", async () => {
    const f = fixture(), token = await SidePanes.createOrGet(options), pane = paneOf(f);
    const input = { hidden: true, canClose: false, width: 600, title: "Updated" };
    expect(SidePanes.update(token, input)).toEqual({
      status: "updated", paneId: options.paneId, changed: ["title", "width", "canClose", "hidden"]
    });
    expect(pane).toMatchObject(input);
    expect(await SidePanes.createOrGet({ ...options, title: "Updated", width: 600, canClose: false })).toBe(token);
    await expect(SidePanes.createOrGet(options)).rejects.toMatchObject({ code: "RESOURCE_CONFLICT" });
    expect(f.host.createPane).toHaveBeenCalledOnce();
    SidePanes.close(token);
    expect(pane.close).toHaveBeenCalledOnce();
    expect(input).toEqual({ hidden: true, canClose: false, width: 600, title: "Updated" });
  });
  it("accepts an explicitly owned ID and reports no-op properties without dispatching setters", async () => {
    const f = fixture(), token = await SidePanes.createOrGet(options), pane = paneOf(f), setter = vi.fn();
    Object.defineProperty(pane, "title", { configurable: true, get: () => options.title, set: setter });
    expect(SidePanes.update(options.paneId, { title: options.title, hidden: false })).toEqual({
      status: "updated", paneId: token.paneId, changed: []
    });
    expect(setter).not.toHaveBeenCalled();
  });
  it.each([300, 1600])("accepts the exact %ipx width bound", async width => {
    fixture(); const token = await SidePanes.createOrGet(options);
    expect(SidePanes.update(token, { width }).changed).toEqual(["width"]);
  });
  it("accepts the exact 256-character title and preserves false boolean values", async () => {
    const f = fixture(), token = await SidePanes.createOrGet(options);
    SidePanes.update(token, { title: "x".repeat(256), canClose: false, hidden: false });
    expect(paneOf(f)).toMatchObject({ title: "x".repeat(256), canClose: false, hidden: false });
  });
  it.each([
    {}, { title: "" }, { title: " " }, { title: "x".repeat(257) }, { title: undefined },
    { width: 299 }, { width: 1601 }, { width: 400.5 }, { width: Number.NaN },
    { hidden: 1 }, { canClose: "false" }, { imageSrc: "https://other.example" },
    { paneId: "vbd_foreign" }, { badge: 1 }, { alwaysRender: true },
    { keepBadgeOnSelect: true }, { title: "Valid", unsupported: true }
  ])("rejects invalid or unsupported patches before native mutation", async patch => {
    const f = fixture(), token = await SidePanes.createOrGet(options), before = { ...paneOf(f) };
    expect(() => Reflect.apply(SidePanes.update, undefined, [token, patch])).toThrow();
    expect(paneOf(f)).toMatchObject({ title: before.title, width: before.width, canClose: before.canClose, hidden: before.hidden });
    SidePanes.select(token);
  });
  it("rejects accessors and unsafe input properties without invoking them", async () => {
    const f = fixture(), token = await SidePanes.createOrGet(options), read = vi.fn();
    const patch = Object.defineProperty({}, "title", { enumerable: true, get: read });
    expect(() => SidePanes.update(token, patch)).toThrow();
    expect(read).not.toHaveBeenCalled();
    const unsafe: unknown = JSON.parse('{"__proto__":{}}');
    expect(() => Reflect.apply(SidePanes.update, undefined, [token, unsafe])).toThrow();
    expect(paneOf(f).title).toBe(options.title);
  });
  it("normalizes a malformed input proxy failure without exposing its text", async () => {
    const f = fixture(), token = await SidePanes.createOrGet(options), cause = new Error("PRIVATE_PROXY");
    const patch = new Proxy({ title: "Not applied" }, { ownKeys() { throw cause; } });
    expect(() => SidePanes.update(token, patch)).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT", cause }));
    expect(paneOf(f).title).toBe(options.title);
  });
  it("preflights all requested writable native properties before changing the first one", async () => {
    const f = fixture(), token = await SidePanes.createOrGet(options), pane = paneOf(f);
    Object.defineProperty(pane, "width", { value: 400, writable: false, configurable: true });
    expect(() => SidePanes.update(token, { title: "Must not apply", width: 500 }))
      .toThrow(expect.objectContaining({ code: "UNSUPPORTED_SURFACE" }));
    expect(pane.title).toBe(options.title);
    SidePanes.select(token);
  });
  it("rejects missing native properties instead of creating fake capabilities", async () => {
    const f = fixture(), token = await SidePanes.createOrGet(options), pane = paneOf(f);
    Reflect.deleteProperty(pane, "hidden");
    expect(() => SidePanes.update(token, { title: "Must not apply", hidden: true }))
      .toThrow(expect.objectContaining({ code: "UNSUPPORTED_SURFACE" }));
    expect(pane.title).toBe(options.title);
    expect(Object.hasOwn(pane, "hidden")).toBe(false);
  });
  it("preserves native probe failures before any setter dispatch and releases the busy guard", async () => {
    const f = fixture(), token = await SidePanes.createOrGet(options), pane = paneOf(f), cause = new Error("PRIVATE_PROBE");
    Object.defineProperty(pane, "width", { configurable: true, get() { throw cause; }, set() { throw new Error("Must not write"); } });
    expect(() => SidePanes.update(token, { title: "Not applied", width: 600 }))
      .toThrow(expect.objectContaining({ code: "SDK_OPERATION_FAILED", cause }));
    expect(pane.title).toBe(options.title);
    SidePanes.close(token);
  });
  it("binds a native property setter to its actual owner", async () => {
    const f = fixture(), token = await SidePanes.createOrGet(options), pane = paneOf(f);
    const owners: unknown[] = []; let title = options.title;
    Object.defineProperty(pane, "title", {
      configurable: true, get: () => title,
      set(this: unknown, value: string) { owners.push(this); title = value; }
    });
    SidePanes.update(token, { title: "Changed" });
    expect(owners).toEqual([pane]); expect(title).toBe("Changed");
  });
  it("supports documented writable properties inherited from a native prototype", async () => {
    const f = fixture(), token = await SidePanes.createOrGet(options), pane = paneOf(f);
    let width = pane.width;
    Reflect.deleteProperty(pane, "width");
    const prototype = Object.create(Object.prototype);
    Object.defineProperty(prototype, "width", {
      get: () => width, set(value: number) { width = value; }, configurable: true
    });
    Object.setPrototypeOf(pane, prototype);
    expect(SidePanes.update(token, { width: 600 }).changed).toEqual(["width"]);
    expect(width).toBe(600);
    expect(Object.hasOwn(pane, "width")).toBe(false);
  });
  it("preflights inherited data properties on a nonextensible native instance before other writes", async () => {
    const f = fixture(), token = await SidePanes.createOrGet(options), pane = paneOf(f);
    Reflect.deleteProperty(pane, "width");
    const prototype = Object.create(Object.prototype);
    Object.defineProperty(prototype, "width", { value: 400, writable: true });
    Object.setPrototypeOf(pane, prototype);
    Object.preventExtensions(pane);
    expect(() => SidePanes.update(token, { title: "Not applied", width: 600 }))
      .toThrow(expect.objectContaining({ code: "UNSUPPORTED_SURFACE" }));
    expect(pane.title).toBe(options.title);
    SidePanes.close(token);
  });
  it("does not adopt forged, stale or foreign handles or unrelated pane instances", async () => {
    const f = fixture(), token = await SidePanes.createOrGet(options), replacement = f.makePane(options);
    expect(() => SidePanes.update({ ...token }, { title: "Forged" })).toThrow();
    expect(() => SidePanes.update("foreign", { title: "Foreign" })).toThrow();
    f.panes.set(options.paneId, replacement);
    expect(() => SidePanes.update(token, { title: "Stale" })).toThrow(expect.objectContaining({ code: "RESOURCE_NOT_FOUND" }));
    expect(replacement.title).toBe(options.title);
    f.panes.clear();
    expect(() => SidePanes.update(token, { title: "Closed" })).toThrow();
  });
  it("detects SDK-host replacement and native pane renaming", async () => {
    const f = fixture(), token = await SidePanes.createOrGet(options), pane = paneOf(f);
    pane.paneId = "renamed";
    expect(() => SidePanes.update(token, { hidden: true })).toThrow(expect.objectContaining({ code: "RESOURCE_NOT_FOUND" }));
    pane.paneId = options.paneId;
    fixture();
    expect(() => SidePanes.update(token, { hidden: true })).toThrow();
    expect(pane.hidden).toBe(false);
  });
  it("rejects update/close/reuse reentry while an owned setter is running", async () => {
    const f = fixture(), token = await SidePanes.createOrGet(options), pane = paneOf(f);
    let title = options.title; let duplicate: Promise<unknown> | undefined;
    Object.defineProperty(pane, "title", {
      configurable: true, get: () => title,
      set(value: string) {
        expect(() => SidePanes.update(token, { width: 600 })).toThrow(expect.objectContaining({ code: "RESOURCE_BUSY" }));
        expect(() => SidePanes.close(token)).toThrow(expect.objectContaining({ code: "RESOURCE_BUSY" }));
        duplicate = SidePanes.createOrGet(options).catch((error: unknown) => error);
        title = value;
      }
    });
    SidePanes.update(token, { title: "Updated" });
    expect(await duplicate).toMatchObject({ code: "RESOURCE_BUSY" });
    SidePanes.select(token);
  });
  it("rejects an update while navigation is pending and releases the navigation lifecycle normally", async () => {
    const f = fixture(), token = await SidePanes.createOrGet(options), pane = paneOf(f);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    pane.navigate.mockImplementationOnce(async () => { await gate; });
    const pending = SidePanes.navigate(token, { pageType: "custom", name: "vbd_summary" });
    expect(() => SidePanes.update(token, { hidden: true })).toThrow(expect.objectContaining({ code: "RESOURCE_BUSY" }));
    release(); await pending;
    SidePanes.update(token, { hidden: true });
    expect(pane.hidden).toBe(true);
  });
  it("reports partial setter failure, records observed title and retains lifecycle/reuse", async () => {
    const f = fixture(), token = await SidePanes.createOrGet(options), pane = paneOf(f);
    const cause = new Error("PRIVATE_SETTER_CANARY"); let width = 400;
    Object.defineProperty(pane, "width", {
      configurable: true, get: () => width,
      set(value: number) { width = value; throw cause; }
    });
    expect(() => SidePanes.update(token, { title: "Updated", width: 600 })).toThrow(expect.objectContaining({
      code: "PARTIAL_FAILURE", cause: expect.objectContaining({ changed: ["title"], attempted: "width", outcome: "uncertain", cause })
    }));
    expect(await SidePanes.createOrGet({ ...options, title: "Updated", width: 600 })).toBe(token);
    SidePanes.select(token); SidePanes.close(token);
    expect(pane.close).toHaveBeenCalledOnce();
  });
  it("treats a first setter that throws after side effects as uncertain, not an unchanged failure", async () => {
    const f = fixture(), token = await SidePanes.createOrGet(options), pane = paneOf(f);
    let title = options.title;
    Object.defineProperty(pane, "title", {
      configurable: true, get: () => title,
      set(value: string) { title = value; throw new Error("PRIVATE_FIRST_SETTER"); }
    });
    try { SidePanes.update(token, { title: "Changed" }); throw new Error("Expected update failure."); }
    catch (error) {
      expect(error).toMatchObject({ code: "PARTIAL_FAILURE", cause: { changed: [], attempted: "title", outcome: "uncertain" } });
      expect(String(error)).not.toContain("PRIVATE_FIRST_SETTER");
    }
    expect(await SidePanes.createOrGet({ ...options, title: "Changed" })).toBe(token);
  });
  it("does not claim success when a setter silently clamps/rejects the requested value", async () => {
    const f = fixture(), token = await SidePanes.createOrGet(options), pane = paneOf(f);
    let width = 400;
    Object.defineProperty(pane, "width", {
      configurable: true, get: () => width, set() { width = 500; }
    });
    expect(() => SidePanes.update(token, { width: 600 })).toThrow(expect.objectContaining({ code: "PARTIAL_FAILURE" }));
    expect(await SidePanes.createOrGet({ ...options, width: 500 })).toBe(token);
  });
  it("does not mutate or adopt a replacement instance installed by a native setter", async () => {
    const f = fixture(), token = await SidePanes.createOrGet(options), pane = paneOf(f), replacement = f.makePane(options);
    let title = options.title;
    Object.defineProperty(pane, "title", {
      configurable: true, get: () => title,
      set(value: string) { title = value; f.panes.set(options.paneId, replacement); }
    });
    expect(() => SidePanes.update(token, { title: "Changed", width: 600 })).toThrow(expect.objectContaining({
      code: "PARTIAL_FAILURE", cause: expect.objectContaining({ attempted: "title", outcome: "uncertain" })
    }));
    expect(replacement).toMatchObject({ title: options.title, width: 400 });
    expect(() => SidePanes.close(token)).toThrow(expect.objectContaining({ code: "RESOURCE_NOT_FOUND" }));
    expect(replacement.close).not.toHaveBeenCalled();
  });
  it("retains observation errors without replacing the original mutation failure or locking the pane forever", async () => {
    const f = fixture(), token = await SidePanes.createOrGet(options), pane = paneOf(f), original = new Error("setter failed");
    let written = false;
    Object.defineProperty(pane, "title", {
      configurable: true, get() { if (written) throw new Error("read-back failed"); return options.title; },
      set() { written = true; throw original; }
    });
    expect(() => SidePanes.update(token, { title: "Changed" })).toThrow(expect.objectContaining({
      code: "PARTIAL_FAILURE", cause: expect.objectContaining({ cause: original, observationFailure: expect.any(Object) })
    }));
    SidePanes.close(token);
    expect(pane.close).toHaveBeenCalledOnce();
  });
});
