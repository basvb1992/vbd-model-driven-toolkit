import { afterEach, describe, expect, it, vi } from "vitest";
import { I18n } from "../src/i18n.js";
import type { LanguageContext } from "../src/i18n.js";

const context: LanguageContext = {
  environmentUrl: "https://example.crm.dynamics.com",
  userId: "11111111-2222-3333-4444-555555555555", languageId: 1033
};
afterEach(() => vi.unstubAllGlobals());

describe("scoped current-user language evidence", () => {
  it("uses only supported native userSettings and getClientUrl without a tenant read", () => {
    const getClientUrl = vi.fn(() => context.environmentUrl);
    const getGlobalContext = vi.fn(() => ({
      getClientUrl, userSettings: { userId: `{${context.userId}}`, languageId: 1043 }
    }));
    vi.stubGlobal("Xrm", { Utility: { getGlobalContext } });
    expect(I18n.getLanguage()).toEqual({
      source: "native", scope: { environmentUrl: context.environmentUrl, userId: context.userId },
      languageId: 1043, locale: null, localeEvidence: "unmapped"
    });
    expect(getGlobalContext).toHaveBeenCalledOnce();
    expect(getClientUrl).toHaveBeenCalledOnce();
    expect(I18n.getLanguage({ localeMap: [{ languageId: 1043, locale: "nl-NL" }] }))
      .toMatchObject({ languageId: 1043, locale: "nl-NL", localeEvidence: "approved-exact-map" });
  });
  it("accepts explicitly scoped supplied LCID evidence, canonicalizing approved mappings only", () => {
    vi.stubGlobal("Xrm", undefined);
    expect(I18n.getLanguage({ context, localeMap: [{ languageId: 1033, locale: "en-us" }] }))
      .toEqual({
        source: "supplied", scope: { environmentUrl: context.environmentUrl, userId: context.userId },
        languageId: 1033, locale: "en-US", localeEvidence: "approved-exact-map"
      });
    expect(I18n.getLanguage({ context: { ...context, languageId: 65535 },
      localeMap: [{ languageId: 1033, locale: "en-US" }] }))
      .toMatchObject({ languageId: 65535, locale: null, localeEvidence: "unmapped" });
  });
  it("does not use browser, OS, environment names or a guessed default for unavailable native context", () => {
    vi.stubGlobal("Xrm", undefined);
    vi.stubGlobal("navigator", { language: "en-US", languages: ["en-US"] });
    expect(() => I18n.getLanguage()).toThrow(expect.objectContaining({ code: "UNSUPPORTED_SURFACE" }));
    vi.stubGlobal("Xrm", { Utility: { getGlobalContext: () => ({ getClientUrl: () => context.environmentUrl,
      userSettings: { userId: context.userId } }) } });
    expect(() => I18n.getLanguage()).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
  });
  it.each([
    { languageId: 0 }, { languageId: 65536 }, { languageId: 1033.5 }, { languageId: "1033" },
    { userId: "unknown" }, { environmentUrl: "http://example.test" },
    { environmentUrl: "https://example.test/path" }, { locale: "en-US" }
  ])("rejects incomplete/invalid scope and unapproved locale metadata: %j", change => {
    expect(() => I18n.getLanguage({ context: { ...context, ...change } } as never)).toThrow();
  });
  it("rejects absent explicit contexts and malformed/duplicate/unvalidated maps", () => {
    for (const options of [
      { context: undefined }, { context: {} }, { context, localeMap: undefined },
      { context, localeMap: [{ languageId: 1033, locale: "zz-ZZ" }] },
      { context, localeMap: [{ languageId: 1033, locale: "en-XX" }] },
      { context, localeMap: [{ languageId: 1033, locale: "en-US" }, { languageId: 1033, locale: "nl-NL" }] },
      { context, localeMap: [{ languageId: 1033, locale: "en-US", guessed: true }] },
      { context, localeMap: new Array(1) }
    ]) expect(() => I18n.getLanguage(options as never)).toThrow();
  });
  it("enforces 64-map bound and does not execute supplied scope/map accessors", () => {
    const map = Array.from({ length: 64 }, (_, i) => ({ languageId: i + 1, locale: "en-US" }));
    expect(I18n.getLanguage({ context, localeMap: map }).locale).toBeNull();
    expect(() => I18n.getLanguage({ context, localeMap: [...map, { languageId: 65, locale: "en-US" }] }))
      .toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
    const getter = vi.fn(() => 1033);
    const supplied = Object.defineProperty({ ...context }, "languageId", { get: getter, enumerable: true });
    expect(() => I18n.getLanguage({ context: supplied })).toThrow();
    const entry = Object.defineProperty({}, "languageId", { get: getter, enumerable: true });
    expect(() => I18n.getLanguage({ context, localeMap: [entry] } as never)).toThrow();
    const array = Object.defineProperty([], "0", { get: getter, enumerable: true });
    expect(() => I18n.getLanguage({ context, localeMap: array } as never)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
  it("retains native SDK failures rather than returning an unknown-success result", () => {
    const cause = new Error("host unavailable");
    vi.stubGlobal("Xrm", { Utility: { getGlobalContext: () => { throw cause; } } });
    expect(() => I18n.getLanguage()).toThrow(expect.objectContaining({ code: "SDK_OPERATION_FAILED", cause }));
  });
});
