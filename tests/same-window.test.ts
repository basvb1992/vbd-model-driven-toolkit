import { afterEach, describe, expect, it, vi } from "vitest";
import { Config } from "../src/configuration.js";
import { Environment } from "../src/environment.js";
import { Launch } from "../src/launch.js";
import type { SameWindowHost } from "../src/launch.js";
import { appId, deferred, launchFixture } from "./environment-helpers.js";
import { configuration, first } from "./helpers.js";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function register(presentation: "sameWindow" | "newWindow" = "sameWindow") {
  const base = configuration();
  const input = {
    ...base, launchProfiles: [{ ...first(base.launchProfiles), presentation }], registrations: []
  };
  const configurationName = `same-${crypto.randomUUID()}`;
  Config.register(configurationName, input);
  return { configurationName, profileKey: "customerWorkspace", input };
}
describe("non-popup model-driven app profiles", () => {
  it("keeps prepared form/grid registrations newWindow-only", () => {
    const config = configuration();
    const invalid = {
      ...config, launchProfiles: [{ ...first(config.launchProfiles), presentation: "sameWindow" }]
    };
    expect(Config.validate(invalid).valid).toBe(false);
    expect(Config.validate({ ...invalid, registrations: [] }).valid).toBe(true);
    expect(Config.validate(config).valid).toBe(true);
  });
  it("rejects newWindow profiles before any reads, preserving the prepared-only policy", async () => {
    const identity = register("newWindow"), f = launchFixture(), navigateSameWindow = vi.fn();
    await expect(Launch.openProfile({
      configurationName: identity.configurationName, profileKey: identity.profileKey,
      context: f.context, host: { navigateSameWindow }
    })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(f.retrieve).not.toHaveBeenCalled();
    expect(navigateSameWindow).not.toHaveBeenCalled();
  });
  it("resolves bindings and requests the approved same-window URL without a popup or activation requirement", async () => {
    const identity = register(), f = launchFixture(), navigateSameWindow = vi.fn();
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const result = await Launch.openProfile({
      configurationName: identity.configurationName, profileKey: identity.profileKey,
      context: f.context, host: { navigateSameWindow }
    });
    expect(result).toEqual({ status: "requested", outcome: "unknown", presentation: "sameWindow" });
    expect(navigateSameWindow).toHaveBeenCalledExactlyOnceWith(`https://target.example/main.aspx?appid=${appId}`);
    expect(f.retrieve).toHaveBeenCalledTimes(6);
    expect(open).not.toHaveBeenCalled();
  });
  it("does not mint prepared popup tokens from a same-window profile", async () => {
    const identity = register(), f = launchFixture();
    await expect(Launch.prepareProfile({
      configurationName: identity.configurationName, profileKey: identity.profileKey, context: f.context
    })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(f.retrieve).not.toHaveBeenCalled();
  });
  it("surfaces synchronous and asynchronous host failures without a successful receipt", async () => {
    const identity = register(), f = launchFixture(), cause = new Error("Host failure");
    for (const navigateSameWindow of [
      () => { throw cause; }, async () => { throw cause; }
    ]) {
      await expect(Launch.openProfile({
        configurationName: identity.configurationName, profileKey: identity.profileKey,
        context: f.context, host: { navigateSameWindow }
      })).rejects.toMatchObject({ code: "WINDOW_REQUEST_FAILED", cause });
    }
  });
  it("honors the native receiver and async adapter completion, not destination readiness", async () => {
    const identity = register(), f = launchFixture(), gate = deferred();
    const receivers: unknown[] = [];
    const host: SameWindowHost = {
      async navigateSameWindow() { receivers.push(this); await gate.promise; }
    };
    let settled = false;
    const pending = Launch.openProfile({
      configurationName: identity.configurationName, profileKey: identity.profileKey, context: f.context, host
    }).then(value => { settled = true; return value; });
    await vi.waitFor(() => expect(receivers[0]).toBe(host));
    expect(settled).toBe(false);
    gate.release();
    await expect(pending).resolves.toMatchObject({ outcome: "unknown" });
  });
  it.each(["scope", "generation", "revision"] as const)("rejects %s changes during resolution before host dispatch", async mode => {
    const identity = register(), f = launchFixture(), gate = deferred(), navigateSameWindow = vi.fn();
    const original = f.retrieve.getMockImplementation();
    if (!original) throw new Error("Missing fixture implementation.");
    f.retrieve.mockImplementationOnce(async (...args) => { await gate.promise; return original(...args); });
    const pending = Launch.openProfile({
      configurationName: identity.configurationName, profileKey: identity.profileKey,
      context: f.context, host: { navigateSameWindow }
    });
    if (mode === "scope") f.scope.languageId = 1043;
    if (mode === "generation") Environment.invalidate(undefined, { context: f.context });
    if (mode === "revision") Config.register(identity.configurationName, identity.input, { replace: true });
    gate.release();
    await expect(pending).rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
    expect(navigateSameWindow).not.toHaveBeenCalled();
  });
  it("checks freshness after capturing the dispatch method, including getters with side effects", async () => {
    const identity = register(), f = launchFixture(), navigate = vi.fn();
    let reads = 0;
    const host = {
      get navigateSameWindow() {
        if (++reads > 1) Environment.invalidate(undefined, { context: f.context });
        return navigate;
      }
    };
    await expect(Launch.openProfile({
      configurationName: identity.configurationName, profileKey: identity.profileKey, context: f.context, host
    })).rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
    expect(navigate).not.toHaveBeenCalled();
  });
  it("expires resolved configuration before a delayed host getter can dispatch it", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
    const identity = register(), f = launchFixture(), navigate = vi.fn();
    let reads = 0;
    const host = {
      get navigateSameWindow() {
        if (++reads > 1) vi.setSystemTime(Date.now() + 1001);
        return navigate;
      }
    };
    await expect(Launch.openProfile({
      configurationName: identity.configurationName, profileKey: identity.profileKey,
      context: f.context, ttlMs: 1000, host
    })).rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
    expect(navigate).not.toHaveBeenCalled();
  });
  it("wraps a dispatch-method getter failure without reporting a request", async () => {
    const identity = register(), f = launchFixture(), cause = new Error("Host getter failure");
    let reads = 0;
    const host = {
      get navigateSameWindow() {
        if (++reads > 1) throw cause;
        return () => undefined;
      }
    };
    await expect(Launch.openProfile({
      configurationName: identity.configurationName, profileKey: identity.profileKey, context: f.context, host
    })).rejects.toMatchObject({ code: "WINDOW_REQUEST_FAILED", cause });
  });
  it("requires the top-level browser or an explicit trusted host; embedded defaults never redirect a parent", async () => {
    const identity = register(), f = launchFixture(), assign = vi.fn();
    vi.stubGlobal("window", globalThis); vi.stubGlobal("self", globalThis);
    vi.stubGlobal("top", {}); vi.stubGlobal("location", { assign });
    await expect(Launch.openProfile({
      configurationName: identity.configurationName, profileKey: identity.profileKey, context: f.context
    })).rejects.toMatchObject({ code: "UNSUPPORTED_SURFACE" });
    expect(f.retrieve).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
  it("uses standard location.assign only in the default top-level host and preserves its receiver", async () => {
    const identity = register(), f = launchFixture(), assign = vi.fn(), location = { assign };
    vi.stubGlobal("window", globalThis); vi.stubGlobal("self", globalThis);
    vi.stubGlobal("top", globalThis); vi.stubGlobal("location", location);
    await expect(Launch.openProfile({
      configurationName: identity.configurationName, profileKey: identity.profileKey, context: f.context
    })).resolves.toMatchObject({ status: "requested" });
    expect(assign).toHaveBeenCalledExactlyOnceWith(`https://target.example/main.aspx?appid=${appId}`);
    expect(assign.mock.contexts[0]).toBe(location);
  });
  it("rejects forbidden destinations and unsupported invocation properties before dispatch", async () => {
    const identity = register(), f = launchFixture(), navigateSameWindow = vi.fn();
    f.variable("vbd_TargetEnvironmentUrl").current = "https://unapproved.example";
    await expect(Launch.openProfile({
      configurationName: identity.configurationName, profileKey: identity.profileKey,
      context: f.context, host: { navigateSameWindow }
    })).rejects.toMatchObject({ code: "INVALID_URL" });
    await expect(Reflect.apply(Launch.openProfile, undefined, [{
      configurationName: identity.configurationName, profileKey: identity.profileKey,
      context: f.context, host: { navigateSameWindow }, url: "https://other.example"
    }])).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(navigateSameWindow).not.toHaveBeenCalled();
  });
  it("does not report success for a malformed host return even though native side effects may have occurred", async () => {
    const identity = register(), f = launchFixture();
    await expect(Reflect.apply(Launch.openProfile, undefined, [{
      configurationName: identity.configurationName, profileKey: identity.profileKey,
      context: f.context, host: { navigateSameWindow: () => 1 }
    }])).rejects.toMatchObject({ code: "DATA_RESPONSE_INVALID" });
  });
});
