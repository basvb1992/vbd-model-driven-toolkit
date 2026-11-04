import { afterEach, describe, expect, it, vi } from "vitest";
import { Links } from "../src/links.js";
import { Diagnostics } from "../src/diagnostics.js";
import { SidePanes } from "../src/side-panes.js";
import type { SidePaneOptions } from "../src/side-panes.js";
import { Windows } from "../src/windows.js";
import { nativeSdk } from "./native-fixture.js";
import { appId } from "./environment-helpers.js";

afterEach(() => vi.unstubAllGlobals());
const link = { environmentUrl: "https://target.example", allowedOrigins: ["https://target.example"], appId };
const ref = { entityType: "account", id: appId };
const options = { paneId: "vbd_help", title: "Help" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}
function fixture() {
  const sdk = nativeSdk();
  const panes = new Map<string, ReturnType<typeof makePane>>();
  function makePane(input: SidePaneOptions) {
    const pane = {
      ...input, width: input.width ?? 400, canClose: input.canClose ?? true,
      navigate: vi.fn(async (_page: unknown): Promise<unknown> => { void _page; return undefined; }),
      select: vi.fn(), close: vi.fn(() => { panes.delete(input.paneId); })
    };
    return pane;
  }
  const host = {
    getPane: vi.fn((id: string) => panes.get(id)),
    createPane: vi.fn(async (input: SidePaneOptions): Promise<unknown> => {
      const pane = makePane(input);
      panes.set(input.paneId, pane);
      return pane;
    })
  };
  const xrm = { ...sdk.xrm, App: { ...sdk.app, sidePanes: host } };
  vi.stubGlobal("Xrm", xrm);
  return { ...sdk, xrm, host, panes, makePane };
}

describe("pure record and view links", () => {
  it("encodes record and nested form identities without a host or navigation", () => {
    vi.stubGlobal("Xrm", undefined);
    const url = new URL(Links.record({ ...link, record: { entityType: "ACCOUNT", id: `{${appId.toUpperCase()}}` }, formId: appId }));
    expect(url.origin).toBe(link.environmentUrl);
    expect(url.pathname).toBe("/main.aspx");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      appid: appId, pagetype: "entityrecord", etn: "account", id: `{${appId}}`, extraqs: `formid=${appId}`
    });
    expect(url.href).toContain("extraqs=formid%3D");
    expect(Links.record({ ...link, record: ref })).not.toContain("extraqs");
    expect(new URL(Links.record({
      environmentUrl: link.environmentUrl, allowedOrigins: link.allowedOrigins, appName: "vbd_App", record: ref
    })).searchParams.get("appname")).toBe("vbd_App");
  });
  it.each([["savedquery", "1039"], ["userquery", "4230"]] as const)("uses the documented %s view type", (viewType, code) => {
    const url = new URL(Links.view({ ...link, entityName: "ACCOUNT", viewId: `{${appId}}`, viewType }));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      appid: appId, pagetype: "entitylist", etn: "account", viewid: `{${appId}}`, viewtype: code
    });
  });
  it.each([
    { environmentUrl: "http://target.example" }, { environmentUrl: "https://unapproved.example" },
    { environmentUrl: "https://target.example/path" }, { environmentUrl: "https://user@target.example" },
    { environmentUrl: "https://target.example?token=redacted" }, { allowedOrigins: [] },
    { appName: "vbd_Also" }, { appId: undefined }, { appId: "invalid" },
    { extraqs: "unsafe" }, { record: { entityType: "account&x=y", id: appId } },
    { record: { entityType: "account", id: "invalid" } }, { formId: "invalid" }
  ])("rejects unapproved or ambiguous record-link inputs", (change) => {
    expect(() => Reflect.apply(Links.record, undefined, [{ ...link, record: ref, ...change }])).toThrow();
  });
  it.each([{ viewType: 1039 }, { viewType: "other" }, { viewId: "bad" }, { entityName: "account?bad" }, { url: "https://other.example" }])(
    "rejects invalid or extra view options", change => {
      expect(() => Reflect.apply(Links.view, undefined, [{
        ...link, entityName: "account", viewId: appId, viewType: "savedquery", ...change
      }])).toThrow();
    });
  it("does not broaden the prepared independent-window URL policy", () => {
    const open = vi.fn(() => null);
    expect(() => Windows.open({
      url: Links.record({ ...link, record: ref }), allowedOrigins: link.allowedOrigins,
      host: { open, isUserActivationActive: () => true }
    })).toThrow();
    expect(open).not.toHaveBeenCalled();
  });
});

describe("owned native side panes", () => {
  it("normalizes creation options, reuses the original handle and binds native receivers", async () => {
    const f = fixture();
    const handle = await SidePanes.createOrGet(options);
    expect(Object.isFrozen(handle)).toBe(true);
    expect(f.host.createPane).toHaveBeenCalledWith({
      ...options, width: 400, canClose: true, hideHeader: false, isSelected: false
    });
    expect(f.host.createPane.mock.contexts[0]).toBe(f.host);
    expect(await SidePanes.createOrGet({ ...options })).toBe(handle);
    expect(f.host.createPane).toHaveBeenCalledOnce();
    await SidePanes.navigate(handle, { pageType: "entityrecord", entityName: "ACCOUNT", entityId: `{${appId}}`, formId: appId });
    const pane = f.panes.get(handle.paneId);
    expect(pane?.navigate).toHaveBeenCalledWith({ pageType: "entityrecord", entityName: "account", entityId: appId, formId: appId });
    expect(pane?.navigate.mock.contexts[0]).toBe(pane);
    expect(SidePanes.select(handle)).toEqual({ status: "requested", paneId: handle.paneId });
    expect(pane?.select.mock.contexts[0]).toBe(pane);
    expect(SidePanes.close(handle.paneId)).toEqual({ status: "closed", paneId: handle.paneId });
    expect(pane?.close.mock.contexts[0]).toBe(pane);
    expect(() => SidePanes.select(handle)).toThrow(expect.objectContaining({ code: "RESOURCE_NOT_FOUND" }));
  });
  it("coalesces concurrent creation but rejects conflicting pending requests and lifecycle calls", async () => {
    const f = fixture(), waiting = deferred<unknown>();
    f.host.createPane.mockImplementationOnce(() => waiting.promise);
    const first = SidePanes.createOrGet(options), second = SidePanes.createOrGet(options);
    await expect(SidePanes.createOrGet({ ...options, width: 500 })).rejects.toMatchObject({ code: "RESOURCE_CONFLICT" });
    expect(() => SidePanes.close(options.paneId)).toThrow(expect.objectContaining({ code: "RESOURCE_BUSY" }));
    await Promise.resolve();
    expect(f.host.createPane).toHaveBeenCalledOnce();
    const pane = f.makePane(options); f.panes.set(options.paneId, pane); waiting.resolve(pane);
    expect(await first).toBe(await second);
  });
  it("does not adopt foreign or externally replaced panes", async () => {
    const f = fixture();
    f.panes.set(options.paneId, f.makePane(options));
    await expect(SidePanes.createOrGet(options)).rejects.toMatchObject({ code: "RESOURCE_CONFLICT" });
    expect(() => SidePanes.close(options.paneId)).toThrow();
    expect(f.host.createPane).not.toHaveBeenCalled();
    f.panes.clear();
    const handle = await SidePanes.createOrGet(options);
    const replacement = f.makePane(options); f.panes.set(options.paneId, replacement);
    expect(() => SidePanes.select(handle)).toThrow(expect.objectContaining({ code: "RESOURCE_NOT_FOUND" }));
    await expect(SidePanes.createOrGet(options)).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    expect(replacement.select).not.toHaveBeenCalled();
    expect(replacement.close).not.toHaveBeenCalled();
  });
  it("expires closed handles, permits fresh creation, and rejects forged handles", async () => {
    const f = fixture();
    const old = await SidePanes.createOrGet(options);
    expect(() => SidePanes.select({ ...old })).toThrow();
    f.panes.clear();
    expect(() => SidePanes.select(old)).toThrow();
    const fresh = await SidePanes.createOrGet(options);
    expect(fresh).not.toBe(old);
    expect(() => SidePanes.close(old)).toThrow();
    SidePanes.select(fresh.paneId);
  });
  it("does not follow a renamed native instance under its previous ID", async () => {
    const f = fixture(), handle = await SidePanes.createOrGet(options), pane = f.panes.get(handle.paneId);
    if (!pane) throw new Error("Missing test pane.");
    pane.paneId = "vbd_renamed";
    expect(() => SidePanes.select(handle)).toThrow(expect.objectContaining({ code: "RESOURCE_NOT_FOUND" }));
    expect(pane.select).not.toHaveBeenCalled();
  });
  it("rejects native option changes and incompatible reuse without mutation", async () => {
    const f = fixture(), handle = await SidePanes.createOrGet(options);
    await expect(SidePanes.createOrGet({ ...options, title: "Other" })).rejects.toMatchObject({ code: "RESOURCE_CONFLICT" });
    const pane = f.panes.get(handle.paneId);
    if (!pane) throw new Error("Missing test pane.");
    pane.width = 600;
    await expect(SidePanes.createOrGet(options)).rejects.toMatchObject({ code: "RESOURCE_CONFLICT" });
    await SidePanes.navigate(handle, { pageType: "custom", name: "vbd_summary" });
    SidePanes.select(handle);
    SidePanes.close(handle);
    expect(pane.close).toHaveBeenCalledOnce();
  });
  it("serializes navigation and rejects close/select/reuse during a pending navigation", async () => {
    const f = fixture(), handle = await SidePanes.createOrGet(options), waiting = deferred<unknown>();
    const pane = f.panes.get(handle.paneId);
    if (!pane) throw new Error("Missing test pane.");
    pane.navigate.mockImplementationOnce(() => waiting.promise);
    const pending = SidePanes.navigate(handle, { pageType: "custom", name: "vbd_summary" });
    expect(() => SidePanes.close(handle)).toThrow(expect.objectContaining({ code: "RESOURCE_BUSY" }));
    expect(() => SidePanes.select(handle)).toThrow();
    await expect(SidePanes.createOrGet(options)).rejects.toMatchObject({ code: "RESOURCE_BUSY" });
    await expect(SidePanes.navigate(handle, { pageType: "custom", name: "vbd_other" })).rejects.toMatchObject({ code: "RESOURCE_BUSY" });
    waiting.resolve(undefined);
    await expect(pending).resolves.toMatchObject({ status: "navigated" });
    SidePanes.close(handle);
  });
  it("observes externally closed or replaced panes after asynchronous navigation", async () => {
    const f = fixture(), handle = await SidePanes.createOrGet(options), waiting = deferred<unknown>();
    f.panes.get(handle.paneId)?.navigate.mockImplementationOnce(() => waiting.promise);
    const pending = SidePanes.navigate(handle, { pageType: "custom", name: "vbd_summary" });
    f.panes.set(handle.paneId, f.makePane(options)); waiting.resolve(undefined);
    await expect(pending).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });
  it("does not auto-adopt or close a pane when creation failed after native side effects", async () => {
    const f = fixture();
    f.host.createPane.mockImplementationOnce(async input => {
      f.panes.set(input.paneId, f.makePane(input));
      throw new Error("Native uncertain create");
    });
    await expect(SidePanes.createOrGet(options)).rejects.toMatchObject({ code: "SDK_OPERATION_FAILED" });
    await expect(SidePanes.createOrGet(options)).rejects.toMatchObject({ code: "RESOURCE_CONFLICT" });
    expect(f.panes.get(options.paneId)?.close).not.toHaveBeenCalled();
  });
  it("permits explicit retry only when native creation left no pane, and releases failed navigation locks", async () => {
    const f = fixture();
    f.host.createPane.mockRejectedValueOnce(new Error("Native failure"));
    await expect(SidePanes.createOrGet(options)).rejects.toMatchObject({ code: "SDK_OPERATION_FAILED" });
    const handle = await SidePanes.createOrGet(options), pane = f.panes.get(handle.paneId);
    pane?.navigate.mockRejectedValueOnce(new Error("Native navigate failure"));
    await expect(SidePanes.navigate(handle, { pageType: "custom", name: "vbd_summary" })).rejects.toMatchObject({ code: "SDK_OPERATION_FAILED" });
    await SidePanes.navigate(handle, { pageType: "webresource", webresourceName: "vbd_/help.html", data: "a&b" });
    expect(pane?.navigate).toHaveBeenLastCalledWith({
      pageType: "webresource", webresourceName: "vbd_/help.html", data: "a&b"
    });
  });
  it("bounds tracked identities, including pending, and reclaims externally closed slots", async () => {
    const f = fixture(), waiting = deferred<unknown>();
    const firstInput = { ...options, paneId: "vbd_pending" };
    f.host.createPane.mockImplementationOnce(() => waiting.promise);
    const first = SidePanes.createOrGet(firstInput);
    await Promise.resolve();
    for (let i = 0; i < 31; i++) await SidePanes.createOrGet({ ...options, paneId: `vbd_${i}` });
    await expect(SidePanes.createOrGet({ ...options, paneId: "vbd_over" })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    const pane = f.makePane(firstInput); f.panes.set(firstInput.paneId, pane); waiting.resolve(pane); await first;
    f.panes.delete("vbd_0");
    await SidePanes.createOrGet({ ...options, paneId: "vbd_over" });
    expect(f.panes.size).toBe(32);
  });
  it.each([
    { width: 299 }, { width: 1601 }, { width: 300.5 }, { title: " " }, { title: "x".repeat(257) },
    { paneId: "../other" }, { paneId: "" }, { imageSrc: "https://other.example/image" }, { canClose: 1 }
  ])("rejects invalid creation before calling the native host", async change => {
    const f = fixture();
    await expect(Reflect.apply(SidePanes.createOrGet, undefined, [{ ...options, ...change }])).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(f.host.createPane).not.toHaveBeenCalled();
  });
  it.each([
    { pageType: "url", url: "https://other.example" },
    { pageType: "entityrecord", entityName: "account" },
    { pageType: "entityrecord", entityName: "account", entityId: "bad" },
    { pageType: "custom", name: "vbd_summary", recordId: appId },
    { pageType: "webresource", webresourceName: "https://other.example/help.html" },
    { pageType: "webresource", webresourceName: "vbd_/../help.html" },
    { pageType: "webresource", webresourceName: "vbd_/help.js" },
    { pageType: "custom", name: "vbd_summary", arbitrary: "{}" }
  ])("rejects unsupported page inputs without invoking navigation", async page => {
    const f = fixture(), handle = await SidePanes.createOrGet(options);
    await expect(Reflect.apply(SidePanes.navigate, undefined, [handle, page])).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(f.panes.get(handle.paneId)?.navigate).not.toHaveBeenCalled();
  });
  it.each(["mobile", "offline", "tablet", "missing"] as const)("fails explicitly on the %s surface", async mode => {
    const f = fixture();
    if (mode === "mobile") f.client.getClient.mockReturnValue("Mobile");
    if (mode === "offline") f.client.getClientState.mockReturnValue("Offline");
    if (mode === "tablet") f.client.getFormFactor.mockReturnValue(2);
    if (mode === "missing") vi.stubGlobal("Xrm", { ...f.xrm, App: {} });
    await expect(SidePanes.createOrGet(options)).rejects.toMatchObject({ code: "UNSUPPORTED_SURFACE" });
    expect(f.host.createPane).not.toHaveBeenCalled();
  });
  it("rejects SDK-host replacement during creation without auto-closing anything", async () => {
    const f = fixture(), waiting = deferred<unknown>();
    f.host.createPane.mockImplementationOnce(() => waiting.promise);
    const pending = SidePanes.createOrGet(options);
    await Promise.resolve();
    fixture();
    const pane = f.makePane(options); f.panes.set(options.paneId, pane); waiting.resolve(pane);
    await expect(pending).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    expect(pane.close).not.toHaveBeenCalled();
  });
  it("does not dispatch a queued create against an already replaced SDK host", async () => {
    const f = fixture();
    const pending = SidePanes.createOrGet(options);
    fixture();
    await expect(pending).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    expect(f.host.createPane).not.toHaveBeenCalled();
  });
  it("does not let native option mutation rewrite the tracked contract", async () => {
    const f = fixture();
    f.host.createPane.mockImplementationOnce(async input => {
      input.title = "Host changed title";
      const pane = f.makePane(input); f.panes.set(input.paneId, pane); return pane;
    });
    await expect(SidePanes.createOrGet(options)).rejects.toMatchObject({ code: "RESOURCE_CONFLICT" });
    await expect(SidePanes.createOrGet(options)).rejects.toMatchObject({ code: "RESOURCE_CONFLICT" });
    expect(options.title).toBe("Help");
  });
  it.each([300, 1600])("accepts the exact %i-pixel width boundary", async width => {
    fixture();
    await expect(SidePanes.createOrGet({ ...options, width, title: "x".repeat(256) })).resolves.toMatchObject({ paneId: options.paneId });
  });
  it("bounds webresource data and copies the native page input", async () => {
    const f = fixture(), handle = await SidePanes.createOrGet(options);
    const page = { pageType: "webresource", webresourceName: "vbd_/help.html", data: "x".repeat(262144) } as const;
    await SidePanes.navigate(handle, page);
    expect(f.panes.get(handle.paneId)?.navigate.mock.calls.at(-1)?.[0]).not.toBe(page);
    await expect(SidePanes.navigate(handle, { ...page, data: "x".repeat(262145) })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });
  it("rejects malformed native creation results without closing or retrying", async () => {
    const f = fixture();
    f.host.createPane.mockResolvedValueOnce({ paneId: options.paneId });
    await expect(SidePanes.createOrGet(options)).rejects.toMatchObject({ code: "DATA_RESPONSE_INVALID" });
    expect(f.host.createPane).toHaveBeenCalledOnce();
  });
  it("keeps native close failures explicit and releases the lifecycle lock", async () => {
    const f = fixture(), handle = await SidePanes.createOrGet(options), pane = f.panes.get(handle.paneId);
    pane?.close.mockImplementationOnce(() => { throw new Error("Close failed"); });
    expect(() => SidePanes.close(handle)).toThrow(expect.objectContaining({ code: "SDK_OPERATION_FAILED" }));
    SidePanes.select(handle);
    SidePanes.close(handle);
    expect(pane?.close).toHaveBeenCalledTimes(2);
  });
  it("blocks reentrant lifecycle operations while the native select runs", async () => {
    const f = fixture(), handle = await SidePanes.createOrGet(options), pane = f.panes.get(handle.paneId);
    pane?.select.mockImplementationOnce(() => {
      expect(() => SidePanes.close(handle)).toThrow(expect.objectContaining({ code: "RESOURCE_BUSY" }));
    });
    SidePanes.select(handle);
    expect(pane?.close).not.toHaveBeenCalled();
  });
});

describe("honest capability observations", () => {
  it("reports missing methods explicitly without requiring Xrm or a DOM", () => {
    vi.stubGlobal("Xrm", undefined);
    expect(Diagnostics.getCapabilities()).toMatchObject({
      basis: "methodPresenceOnly", capabilities: {
        navigation: "absent", quickCreate: "absent", lookups: "absent",
        environmentReads: "absent", sidePanes: "absent", notifications: "absent"
      }
    });
  });
  it("inspects method presence only, never invoking APIs or reading current values", () => {
    const f = fixture(), getGlobalContext = vi.fn(() => { throw new Error("Must not invoke"); });
    vi.stubGlobal("Xrm", { ...f.xrm, Utility: { ...f.utility, getGlobalContext } });
    expect(Diagnostics.getCapabilities()).toMatchObject({
      basis: "methodPresenceOnly", capabilities: {
        navigation: "present", quickCreate: "present", lookups: "present",
        environmentReads: "absent", sidePanes: "present", notifications: "present"
      }
    });
    expect(getGlobalContext).not.toHaveBeenCalled();
    expect(f.host.createPane).not.toHaveBeenCalled();
    expect(f.host.getPane).not.toHaveBeenCalled();
    expect(f.navigation.navigateTo).not.toHaveBeenCalled();
  });
  it("does not turn a failed probe into an absent or successful result", () => {
    vi.stubGlobal("Xrm", Object.defineProperty({}, "App", { get() { throw new Error("Probe failed"); } }));
    expect(() => Diagnostics.getCapabilities()).toThrow(expect.objectContaining({ code: "SDK_OPERATION_FAILED" }));
  });
});
