import { afterEach, describe, expect, it, vi } from "vitest";
import { Config, Environment, Launch, Links, Windows } from "../src/index.js";
import type { WindowHost } from "../src/index.js";
import { configuration, first } from "./helpers.js";
import { appId, deferred, launchFixture } from "./environment-helpers.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function register() {
  const configurationName = `launch-${crypto.randomUUID()}`;
  Config.register(configurationName, configuration());
  return { configurationName, profileKey: "customerWorkspace" };
}

function windowFixture() {
  const activation = vi.fn((): boolean | undefined => true);
  const open = vi.fn<WindowHost["open"]>(() => null);
  const host: WindowHost = { isUserActivationActive: activation, open };
  return { host, activation, open };
}

describe("approved model-driven app links", () => {
  it("builds a canonical app ID or unique-name link, never both", () => {
    expect(Links.app({
      environmentUrl: "https://TARGET.example/", allowedOrigins: ["https://target.example"],
      appId: `{${appId.toUpperCase()}}`
    })).toBe(`https://target.example/main.aspx?appid=${appId}`);
    expect(Links.app({
      environmentUrl: "https://target.example", allowedOrigins: ["https://target.example"],
      appName: "vbd_CustomerWorkspace"
    })).toBe("https://target.example/main.aspx?appname=vbd_CustomerWorkspace");
    for (const identity of [{}, { appId, appName: "vbd_App" }, { appId: "invalid" }, { appName: "bad name" }]) {
      expect(() => Links.app({
        environmentUrl: "https://target.example", allowedOrigins: ["https://target.example"], ...identity
      })).toThrow();
    }
  });

  it.each([
    "http://target.example", "javascript:alert(1)", "https://user:pass@target.example",
    "https://target.example/path", "https://target.example?token=CANARY",
    "https://target.example#fragment", "https://target.example\\path",
    " https://target.example", "https://target.example.evil.test",
    "https://target.example:444"
  ])("rejects unsafe/non-approved environment %s", (environmentUrl) => {
    expect(() => Links.app({ environmentUrl, appId, allowedOrigins: ["https://target.example"] })).toThrow();
  });

  it("does not accept an invalid approved-origin entry or extra caller parameters", () => {
    expect(() => Links.app({
      environmentUrl: "https://target.example", appId, allowedOrigins: ["https://target.example/path"]
    })).toThrow();
    expect(() => Reflect.apply(Links.app, undefined, [{
      environmentUrl: "https://target.example", appId,
      allowedOrigins: ["https://target.example"], token: "CANARY"
    }])).toThrow();
  });
});

describe("isolated synchronous window requests", () => {
  const url = `https://target.example/main.aspx?appid=${appId}`;

  it.each([null, undefined, false, { closed: false }])(
    "reports only requested/unknown regardless of returned handle: %j", (handle) => {
      const browser = windowFixture();
      browser.open.mockReturnValue(handle);
      expect(Windows.open({
        url, allowedOrigins: ["https://target.example"], host: browser.host, width: 900, height: 700
      })).toEqual({ status: "requested", outcome: "unknown", isolation: "noopener,noreferrer" });
      expect(browser.open).toHaveBeenCalledExactlyOnceWith(
        url, "_blank", "noopener,noreferrer,width=900,height=700"
      );
    }
  );

  it("requires active observable user activation before any open call", () => {
    const browser = windowFixture();
    browser.activation.mockReturnValue(false);
    expect(() => Windows.open({ url, allowedOrigins: ["https://target.example"], host: browser.host }))
      .toThrow(expect.objectContaining({ code: "USER_ACTIVATION_REQUIRED" }));
    browser.activation.mockReturnValue(undefined);
    expect(() => Windows.open({ url, allowedOrigins: ["https://target.example"], host: browser.host }))
      .toThrow(expect.objectContaining({ code: "UNSUPPORTED_SURFACE" }));
    expect(browser.open).not.toHaveBeenCalled();
  });

  it.each([
    `https://target.example/main.aspx?appid=${appId}&token=CANARY`,
    `https://target.example/main.aspx?appid=${appId}&appid=${appId}`,
    "https://target.example/main.aspx?etn=account",
    `https://target.example/main.aspx?appid=${appId}#fragment`,
    `https://user:pass@target.example/main.aspx?appid=${appId}`,
    `https://other.example/main.aspx?appid=${appId}`
  ])("rejects an unsupported window destination without opening it: %s", (destination) => {
    const browser = windowFixture();
    expect(() => Windows.open({
      url: destination, allowedOrigins: ["https://target.example"], host: browser.host
    })).toThrow();
    expect(browser.open).not.toHaveBeenCalled();
  });

  it("surfaces browser request exceptions instead of returning success", () => {
    const browser = windowFixture();
    const cause = new Error("BROWSER_CANARY");
    browser.open.mockImplementation(() => { throw cause; });
    expect(() => Windows.open({ url, allowedOrigins: ["https://target.example"], host: browser.host }))
      .toThrow(expect.objectContaining({ code: "WINDOW_REQUEST_FAILED", cause }));
  });

  it("surfaces activation-provider exceptions without issuing a window request", () => {
    const browser = windowFixture();
    const cause = new Error("ACTIVATION_CANARY");
    browser.activation.mockImplementation(() => { throw cause; });
    expect(() => Windows.open({ url, allowedOrigins: ["https://target.example"], host: browser.host }))
      .toThrow(expect.objectContaining({ code: "WINDOW_REQUEST_FAILED", cause }));
    expect(browser.open).not.toHaveBeenCalled();
  });

  it("enforces dimension bounds and disallows arbitrary feature overrides", () => {
    const browser = windowFixture();
    for (const width of [99, 4097, 100.5]) {
      expect(() => Windows.open({ url, allowedOrigins: ["https://target.example"], host: browser.host, width }))
        .toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
    }
    expect(() => Windows.open({
      url, allowedOrigins: ["https://target.example"], host: browser.host, width: 100, height: 4096
    })).not.toThrow();
    expect(() => Reflect.apply(Windows.open, undefined, [{
      url, allowedOrigins: ["https://target.example"], host: browser.host, features: "opener"
    }])).toThrow();
  });

  it("uses the browser-native synchronous adapter with opener/referrer isolation", () => {
    const open = vi.fn(() => null);
    vi.stubGlobal("open", open);
    vi.stubGlobal("navigator", { userActivation: { isActive: true } });
    expect(Windows.open({ url, allowedOrigins: ["https://target.example"] }).outcome).toBe("unknown");
    expect(open).toHaveBeenCalledExactlyOnceWith(url, "_blank", "noopener,noreferrer");
  });
});

describe("prepared launch profiles", () => {
  it("resolves before the click and performs no asynchronous reads while opening", async () => {
    const identity = register();
    const source = launchFixture();
    const browser = windowFixture();
    const token = await Launch.prepareProfile({ ...identity, context: source.context });
    const readCount = source.retrieve.mock.calls.length;
    expect(Object.isFrozen(token)).toBe(true);
    expect(Object.keys(token).sort()).toEqual(["expiresAt", "id"]);
    expect(JSON.stringify(token)).not.toMatch(/target\.example|11111111/);
    const result = Launch.openPrepared(token, { host: browser.host });
    expect(result).not.toBeInstanceOf(Promise);
    expect(result).toMatchObject({ status: "requested", outcome: "unknown" });
    expect(source.retrieve).toHaveBeenCalledTimes(readCount);
    expect(browser.open).toHaveBeenCalledExactlyOnceWith(
      `https://target.example/main.aspx?appid=${appId}`, "_blank", "noopener,noreferrer"
    );
  });

  it("returns isolated profile copies and reports missing registrations/profiles", () => {
    const identity = register();
    const firstProfile = Launch.getProfile(identity);
    firstProfile.appId.environmentVariable = "vbd_Modified";
    expect(Launch.getProfile(identity).appId.environmentVariable).toBe("vbd_TargetModelDrivenAppId");
    expect(() => Launch.getProfile({ ...identity, profileKey: "missing" }))
      .toThrow(expect.objectContaining({ code: "CONFIG_NOT_FOUND" }));
    expect(() => Launch.getProfile({ ...identity, configurationName: "missing" })).toThrow();
  });

  it("rejects copied/forged tokens and unknown caller overrides", async () => {
    const identity = register();
    const source = launchFixture();
    const browser = windowFixture();
    const token = await Launch.prepareProfile({ ...identity, context: source.context });
    expect(() => Launch.openPrepared({ ...token }, { host: browser.host }))
      .toThrow(expect.objectContaining({ code: "CONFIG_NOT_READY" }));
    expect(() => Reflect.apply(Launch.openPrepared, undefined, [token, {
      host: browser.host, url: "https://other.example"
    }])).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
    expect(browser.open).not.toHaveBeenCalled();
  });

  it("expires exactly at source freshness even when preparation occurs later", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T10:00:00Z"));
    const identity = register();
    const source = launchFixture();
    const browser = windowFixture();
    await Environment.getText("vbd_TargetModelDrivenAppId", { context: source.context });
    const initial = Date.now();
    vi.setSystemTime(initial + 30_000);
    const token = await Launch.prepareProfile({ ...identity, context: source.context });
    expect(token.expiresAt).toBe(initial + 60_000);
    vi.setSystemTime(token.expiresAt);
    expect(() => Launch.openPrepared(token, { host: browser.host }))
      .toThrow(expect.objectContaining({ code: "CONFIG_EXPIRED" }));
    expect(browser.open).not.toHaveBeenCalled();
  });

  it.each(["user", "environment", "language", "replace", "invalidate"] as const)(
    "invalidates a prepared token on %s change", async (change) => {
      const identity = register();
      const source = launchFixture();
      const browser = windowFixture();
      const token = await Launch.prepareProfile({ ...identity, context: source.context });
      switch (change) {
        case "user": source.scope.userId = crypto.randomUUID(); break;
        case "environment": source.scope.environmentUrl = "https://another.example"; break;
        case "language": source.scope.languageId = 1043; break;
        case "replace": Config.register(identity.configurationName, configuration(), { replace: true }); break;
        case "invalidate": Environment.invalidate(undefined, { context: source.context }); break;
      }
      expect(() => Launch.openPrepared(token, { host: browser.host }))
        .toThrow(expect.objectContaining({ code: "CONFIG_EXPIRED" }));
      expect(browser.open).not.toHaveBeenCalled();
    }
  );

  it("rejects registry replacement during preparation and waits for started reads", async () => {
    const identity = register();
    const source = launchFixture();
    const gate = deferred();
    const original = source.retrieve.getMockImplementation();
    if (!original) { throw new Error("Fixture requires an implementation."); }
    source.retrieve.mockImplementation(async (...args) => { await gate.promise; return original(...args); });
    const pending = Launch.prepareProfile({ ...identity, context: source.context });
    const expected = expect(pending).rejects.toMatchObject({ code: "CONFIG_EXPIRED" });
    Config.register(identity.configurationName, configuration(), { replace: true });
    gate.release();
    await expected;
  });

  it("rejects secrets and unsafe resolved origins during preparation", async () => {
    const identity = register();
    const source = launchFixture();
    source.variable("vbd_TargetModelDrivenAppId").type = 100000005;
    await expect(Launch.prepareProfile({ ...identity, context: source.context }))
      .rejects.toMatchObject({ code: "SECRET_NOT_SUPPORTED" });
    source.variable("vbd_TargetModelDrivenAppId").type = 100000000;
    source.variable("vbd_TargetEnvironmentUrl").current = "https://unapproved.example";
    Environment.invalidate(undefined, { context: source.context });
    await expect(Launch.prepareProfile({ ...identity, context: source.context }))
      .rejects.toMatchObject({ code: "INVALID_URL" });
  });

  it("supports the current environment when a profile omits an external environment binding", async () => {
    const identity = register();
    const input = Config.get(identity.configurationName);
    delete first(input.launchProfiles).environmentUrl;
    Config.register(identity.configurationName, input, { replace: true });
    const source = launchFixture();
    source.variable("vbd_ApprovedAppOrigin").current = source.scope.environmentUrl;
    const browser = windowFixture();
    const token = await Launch.prepareProfile({ ...identity, context: source.context });
    Launch.openPrepared(token, { host: browser.host });
    expect(browser.open.mock.calls[0]?.[0]).toBe(`https://source.example/main.aspx?appid=${appId}`);
  });

  it("bounds TTL and keeps at most 128 prepared tokens", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T10:00:00Z"));
    const identity = register();
    const source = launchFixture();
    for (const ttlMs of [0, 300001, 1.5]) {
      await expect(Launch.prepareProfile({ ...identity, context: source.context, ttlMs }))
        .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    }
    expect(source.retrieve).not.toHaveBeenCalled();
    const firstToken = await Launch.prepareProfile({ ...identity, context: source.context, ttlMs: 300000 });
    let last = firstToken;
    for (let index = 0; index < 128; index++) {
      last = await Launch.prepareProfile({ ...identity, context: source.context, ttlMs: 300000 });
    }
    const browser = windowFixture();
    expect(() => Launch.openPrepared(firstToken, { host: browser.host }))
      .toThrow(expect.objectContaining({ code: "CONFIG_NOT_READY" }));
    expect(Launch.openPrepared(last, { host: browser.host }).status).toBe("requested");
  });
});
