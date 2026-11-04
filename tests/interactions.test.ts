import { afterEach, describe, expect, it, vi } from "vitest";
import { Context } from "../src/context.js";
import { Navigation, Dialogs } from "../src/navigation.js";
import { UI } from "../src/ui.js";
import type { ProgressToken } from "../src/ui.js";
import { Grids, Commands } from "../src/commands.js";
import { VbdError } from "../src/errors.js";
import { isRecord } from "../src/validation.js";
import { nativeForm, nativeGrid, nativeSdk } from "./native-fixture.js";
import { appId } from "./environment-helpers.js";

afterEach(() => { vi.unstubAllGlobals(); });

describe("native contexts and selection", () => {
  it("normalizes explicit form/event and CRM grid contexts without a global form", () => {
    const form = nativeForm(), grid = nativeGrid();
    expect(Context.fromFormEvent(form.execution).surface).toBe("formEvent");
    const formContext = Context.fromFormCommand(form.form);
    expect(Context.getSelection(formContext)).toEqual([]);
    const context = Context.fromGridCommand(grid.grid, [{ Id: `{${appId}}`, TypeName: "ACCOUNT", Name: "Fixture" }]);
    expect(Context.getSelection(context)).toEqual([{ entityType: "account", id: appId, name: "Fixture" }]);
    const copy = Context.getSelection(context);
    copy.splice(0, 1);
    expect(Context.getSelection(context)).toHaveLength(1);
    expect(Context.requireSavedRecord(context)).toMatchObject({ entityType: "account", id: appId });
    expect(Context.fromGridCommand(grid.grid, [appId]).selection).toEqual([{ entityType: "account", id: appId }]);
    expect(() => Context.fromFormCommand(grid.grid)).toThrow();
    expect(() => Context.fromGridCommand(form.form)).toThrow();
    expect(() => Context.fromGridCommand(grid.grid, [{ id: appId, Id: crypto.randomUUID(), entityType: "account" }])).toThrow();
    expect(() => Context.fromGridCommand(grid.grid, [appId, appId])).toThrow();
  });

  it("reports actual client/app/user metadata, not authorization or assumed roles", async () => {
    const sdk = nativeSdk(), form = nativeForm();
    vi.stubGlobal("Xrm", sdk.xrm);
    expect(Context.getClient()).toEqual({ client: "Web", state: "Online", formFactor: 1 });
    expect(await Context.getApp()).toMatchObject({ appId, uniqueName: "vbd_Fixture" });
    expect(Context.getUser()).toMatchObject({ userId: sdk.settings.userId, languageId: 1033, rolesAvailable: false, roleIds: [] });
    const context = Context.fromFormCommand(form.form);
    for (const capability of ["form", "navigation", "lookup", "online"] as const) {
      expect(Context.requireCapability(context, capability)).toEqual({ available: true });
    }
    expect(() => Context.requireCapability(context, "grid")).toThrow();
    sdk.client.getClientState.mockReturnValue("Offline");
    expect(() => Context.requireCapability(context, "online")).toThrow();
    vi.stubGlobal("Xrm", undefined);
    expect(() => Context.getUser()).toThrow();
  });

  it("uses only selected rows, enforces explicit selection policy and refreshes the right surface", async () => {
    const sdk = nativeSdk(), grid = nativeGrid(), form = nativeForm();
    vi.stubGlobal("Xrm", sdk.xrm);
    expect(Grids.getSelected(grid.grid)).toEqual([{ entityType: "account", id: appId }]);
    expect(Commands.validateSelection([]).valid).toBe(false);
    expect(Commands.validateSelection([], { min: 0 }).valid).toBe(true);
    expect(Commands.validateSelection([
      { entityType: "account", id: appId }, { entityType: "contact", id: crypto.randomUUID() }
    ]).issues).toContain("mixedTables");
    expect(Commands.validateSelection([{ entityType: "account", id: appId }], { entityType: "contact" }).issues).toContain("wrongTable");
    expect(() => Commands.validateSelection([], { min: 2, max: 1 })).toThrow();
    Grids.refresh(grid.grid);
    expect(grid.grid.refresh).toHaveBeenCalledOnce();
    Commands.refresh(Context.fromGridCommand(grid.grid));
    Commands.refresh(Context.fromFormCommand(form.form), true);
    expect(grid.grid.refreshRibbon).toHaveBeenCalledOnce();
    expect(form.form.ui.refreshRibbon).toHaveBeenCalledWith(true);
    await Grids.openSelected(grid.grid, { mode: "dialog" });
    expect(sdk.navigation.navigateTo).toHaveBeenCalledWith(
      { pageType: "entityrecord", entityName: "account", entityId: appId },
      { target: 2, position: 1 }
    );
    grid.state.references = [];
    await expect(Grids.openSelected(grid.grid)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(Context.getRecord(Context.fromGridCommand(grid.grid)).state).toBe("none");
  });

  it("rejects selections beyond the 1000-item bound", () => {
    const grid = nativeGrid(Array.from({ length: 1001 }, () => ({ entityType: "account", id: crypto.randomUUID() })));
    expect(() => Context.fromGridCommand(grid.grid)).toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
    expect(() => Commands.validateSelection(Array.from({ length: 1001 }, () => ({
      entityType: "account", id: crypto.randomUUID()
    })))).toThrow();
  });
});

describe("supported native navigation contracts", () => {
  it("opens inline and modal records without waiting for a Quick Create-only callback", async () => {
    const sdk = nativeSdk();
    vi.stubGlobal("Xrm", sdk.xrm);
    expect(await Navigation.openRecord({ entityType: "account", id: appId })).toMatchObject({ status: "navigated" });
    expect(sdk.navigation.openForm).not.toHaveBeenCalled();
    const result = await Dialogs.record({ entityType: "account", id: appId }, {
      title: "Record", width: { value: 80, unit: "%" }, position: "side"
    });
    expect(result).toEqual({ status: "closed", result: undefined });
    expect(sdk.navigation.navigateTo).toHaveBeenLastCalledWith(
      { pageType: "entityrecord", entityName: "account", entityId: appId },
      { target: 2, position: 2, width: { value: 80, unit: "%" }, title: "Record" }
    );
    await Navigation.newRecord("account", { mode: "dialog", data: { name: "Fixture", number: 0, enabled: false } });
    expect(sdk.navigation.navigateTo).toHaveBeenLastCalledWith(expect.objectContaining({
      pageType: "entityrecord", entityName: "account", data: { name: "Fixture", number: 0, enabled: false }
    }), expect.objectContaining({ target: 2 }));
    await expect(Reflect.apply(Navigation.openRecord, undefined, [
      { entityType: "account", id: appId }, { mode: "newWindow" }
    ])).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(Reflect.apply(Dialogs.record, undefined, [
      { entityType: "account", id: appId }, { mode: "inline" }
    ])).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  it("honors Quick Create's documented save result and explicit response validation", async () => {
    const sdk = nativeSdk();
    vi.stubGlobal("Xrm", sdk.xrm);
    expect(await Navigation.quickCreate("account", { data: { name: "Fixture" } }))
      .toMatchObject({ status: "saved", records: [{ entityType: "account", id: appId, name: "Fixture" }] });
    expect(sdk.navigation.openForm).toHaveBeenCalledWith(
      { entityName: "account", useQuickCreateForm: true }, { name: "Fixture" }
    );
    sdk.navigation.openForm.mockResolvedValueOnce({ savedEntityReference: [] });
    await expect(Navigation.quickCreate("account")).rejects.toMatchObject({ code: "DATA_RESPONSE_INVALID" });
  });

  it("keeps lists/dashboard inline and custom/webresource parameters page-specific", async () => {
    const sdk = nativeSdk();
    vi.stubGlobal("Xrm", sdk.xrm);
    await Navigation.openView("account", { viewId: appId, viewType: "savedquery" });
    await Navigation.openDashboard(appId);
    await Navigation.openCustomPage("vbd_summary", { entityName: "account", recordId: appId });
    await Dialogs.customPage("vbd_summary", { recordId: appId, entityName: "account", height: 600 });
    await Navigation.openWebResource("vbd_/toolkit/page.html", { data: "explicit" });
    await Dialogs.webResource("vbd_/toolkit/page.html", { data: "explicit" });
    expect(sdk.navigation.navigateTo).toHaveBeenCalledTimes(6);
    await expect(Navigation.openView("account", { viewType: "userquery" })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(Navigation.openCustomPage("vbd_summary", { recordId: appId })).rejects.toThrow();
    await expect(Navigation.openCustomPage("vbd_summary", { recordId: "encoded-json", entityName: "account" })).rejects.toThrow();
    await expect(Navigation.openWebResource("../unsafe.html")).rejects.toThrow();
    await expect(Navigation.openRecord({ entityType: "account", id: appId }, { width: 800 })).rejects.toThrow();
  });

  it("supports only deliberately approved HTTPS URL requests and query keys", () => {
    const sdk = nativeSdk();
    vi.stubGlobal("Xrm", sdk.xrm);
    const input = { url: "https://help.example/path?article=one", allowedOrigins: ["https://help.example"] };
    expect(() => Navigation.openUrl(input)).toThrow();
    expect(Navigation.openUrl({ ...input, allowedQueryKeys: ["article"], width: 800 })).toEqual({ status: "requested" });
    expect(sdk.navigation.openUrl).toHaveBeenCalledWith(input.url, { width: 800 });
    expect(() => Navigation.openUrl({ url: "javascript:alert(1)", allowedOrigins: ["https://help.example"] })).toThrow();
    expect(() => Navigation.openUrl({ url: "https://user:pass@help.example", allowedOrigins: ["https://help.example"] })).toThrow();
    expect(() => Navigation.openUrl({ url: "https://other.example", allowedOrigins: ["https://help.example"] })).toThrow();
    expect(sdk.navigation.openUrl).toHaveBeenCalledTimes(1);
  });

  it("distinguishes confirmations/cancellation and never displays native error payloads", async () => {
    const sdk = nativeSdk();
    vi.stubGlobal("Xrm", sdk.xrm);
    expect(await Dialogs.alert("Acknowledge")).toEqual({ status: "acknowledged" });
    expect(await Dialogs.confirm("Continue?")).toEqual({ status: "confirmed" });
    sdk.navigation.openConfirmDialog.mockResolvedValueOnce({ confirmed: false });
    expect(await Dialogs.confirm("Continue?")).toEqual({ status: "cancelled" });
    const result = await Dialogs.error(new Error("RAW_SECRET_CANARY"));
    expect(result.status).toBe("closed");
    expect(JSON.stringify(sdk.navigation.openErrorDialog.mock.calls)).not.toContain("RAW_SECRET_CANARY");
    expect(JSON.stringify(sdk.navigation.openErrorDialog.mock.calls)).toContain(result.correlationId);
    sdk.navigation.navigateTo.mockRejectedValueOnce(new Error("SDK_CANARY"));
    await expect(Navigation.openRecord({ entityType: "account", id: appId })).rejects.toMatchObject({ code: "SDK_OPERATION_FAILED" });
    vi.stubGlobal("Xrm", undefined);
    await expect(Dialogs.alert("Missing client")).rejects.toMatchObject({ code: "UNSUPPORTED_SURFACE" });
  });
});

describe("native VBD progress/notification ownership", () => {
  it("does not close a newer VBD progress owner and restores the previous message", () => {
    const sdk = nativeSdk();
    vi.stubGlobal("Xrm", sdk.xrm);
    const first = UI.showProgress("First"), second = UI.showProgress("Second");
    UI.hideProgress(second);
    expect(sdk.utility.showProgressIndicator).toHaveBeenLastCalledWith("First");
    expect(sdk.utility.closeProgressIndicator).not.toHaveBeenCalled();
    UI.hideProgress(first);
    expect(sdk.utility.closeProgressIndicator).toHaveBeenCalledOnce();
    expect(UI.hideProgress(first)).toEqual({ removed: false });
    expect(() => UI.hideProgress({ id: first.id })).toThrow();
  });

  it("cleans up normal/failed operations and preserves both failures and a retryable cleanup token", async () => {
    const sdk = nativeSdk();
    vi.stubGlobal("Xrm", sdk.xrm);
    expect(await UI.withProgress("Work", () => 0)).toBe(0);
    const original = new Error("OPERATION_CANARY");
    await expect(UI.withProgress("Failure", () => { throw original; })).rejects.toMatchObject({
      code: "OPERATION_FAILED", cause: original
    });
    sdk.utility.closeProgressIndicator.mockImplementationOnce(() => { throw new Error("CLEANUP_CANARY"); });
    const error: unknown = await UI.withProgress("Both", () => { throw original; }).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: "PARTIAL_FAILURE", cause: { error: original } });
    const isProgressToken = (value: unknown): value is ProgressToken =>
      isRecord(value) && typeof value.id === "string";
    if (!(error instanceof VbdError) || !isRecord(error.cause) || !isProgressToken(error.cause.token)) {
      throw new Error("Missing recovery token.");
    }
    UI.hideProgress(error.cause.token);
  });

  it("uses official levels and clears only a returned owned global notification", async () => {
    const sdk = nativeSdk();
    vi.stubGlobal("Xrm", sdk.xrm);
    const token = await UI.notify("Configured message", { level: "warning" });
    expect(sdk.app.addGlobalNotification).toHaveBeenCalledWith({
      type: 2, level: 3, message: "Configured message", showCloseButton: true
    });
    expect(await UI.clearNotification(token)).toEqual({ removed: true });
    expect(sdk.app.clearGlobalNotification).toHaveBeenCalledWith(token.id);
    expect(await UI.clearNotification(token)).toEqual({ removed: false });
    await expect(UI.clearNotification({ id: token.id })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(Reflect.apply(UI.notify, undefined, ["Message", { duration: 1000 }])).rejects.toThrow();
  });
});
