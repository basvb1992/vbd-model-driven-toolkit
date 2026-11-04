import { afterEach, describe, expect, it, vi } from "vitest";
import { I18n } from "../src/i18n.js";
import { Utils } from "../src/utils.js";
import { VbdError } from "../src/errors.js";

const nativeIntl = Intl;
const context = {
  environmentUrl: "https://example.crm.dynamics.com",
  userId: "11111111-2222-3333-4444-555555555555", languageId: 1033
};
const decimal = { style: "decimal" } as const;
const dateOnly = { behavior: "dateOnly", dateStyle: "long" } as const;
function partialIntl(changes: Readonly<Record<string, unknown>>): object {
  return {
    getCanonicalLocales: nativeIntl.getCanonicalLocales,
    NumberFormat: nativeIntl.NumberFormat,
    DateTimeFormat: nativeIntl.DateTimeFormat,
    supportedValuesOf: nativeIntl.supportedValuesOf,
    ...changes
  };
}
const localizedCalls = [
  { operation: "i18n.formatNumber", run: () => I18n.formatNumber(1, "en-US", decimal) },
  { operation: "i18n.formatDate", run: () => I18n.formatDate("2024-02-29", "en-US", dateOnly) },
  { operation: "i18n.translate", run: () => I18n.translate("key", "en-US",
    { resources: { "en-US": { key: "text" } }, onMissing: "error" }) },
  { operation: "i18n.getLanguage", run: () => I18n.getLanguage({
    context, localeMap: [{ languageId: 1033, locale: "en-US" }]
  }) },
  { operation: "utils.formatValue", run: () => Utils.formatValue({ kind: "text", value: "" },
    { locale: "en-US", nulls: { policy: "error" } }) }
];
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("lazy optional Intl capabilities", () => {
  it("initializes Core and localization without Intl; only locale-dependent use fails", async () => {
    vi.stubGlobal("Intl", undefined);
    vi.resetModules();
    const core = await import("../src/index.js");
    const localization = await import("../src/i18n.js");
    expect(core.Utils.normalizeGuid(`{${context.userId}}`)).toBe(context.userId);
    expect(localization.I18n.getLanguage({ context }))
      .toMatchObject({ languageId: 1033, locale: null, localeEvidence: "unmapped" });
    expect(() => localization.I18n.formatNumber(1, "en-US", decimal))
      .toThrow(expect.objectContaining({ code: "UNSUPPORTED_SURFACE", operation: "i18n.formatNumber" }));
  });
  it.each([
    ["undefined", undefined], ["null", null], ["non-object", 1], ["empty", {}],
    ["missing getCanonicalLocales", partialIntl({ getCanonicalLocales: undefined })],
    ["non-callable getCanonicalLocales", partialIntl({ getCanonicalLocales: {} })],
    ["missing NumberFormat", partialIntl({ NumberFormat: undefined })],
    ["non-callable NumberFormat", partialIntl({ NumberFormat: {} })],
    ["missing DateTimeFormat", partialIntl({ DateTimeFormat: undefined })],
    ["non-callable DateTimeFormat", partialIntl({ DateTimeFormat: {} })]
  ])("returns structured method-use errors with %s Intl capability", (_label, api) => {
    vi.stubGlobal("Intl", api);
    for (const call of localizedCalls) {
      expect(call.run).toThrow(VbdError);
      expect(call.run).toThrow(expect.objectContaining({
        code: "UNSUPPORTED_SURFACE", operation: call.operation
      }));
    }
    expect(I18n.getLanguage({ context }).locale).toBeNull();
    expect(Utils.escapeODataLiteral(0, "number")).toBe("0");
  });
  it.each([undefined, {}])("requires supportedValuesOf only for currency: %s", supportedValuesOf => {
    vi.stubGlobal("Intl", partialIntl({ supportedValuesOf }));
    expect(I18n.formatNumber(1, "en-US", decimal)).toBe("1");
    expect(I18n.formatDate("2024-02-29", "en-GB", dateOnly)).toBe("29 February 2024");
    expect(I18n.translate("key", "en-US", { resources: {}, onMissing: "key" })).toBe("key");
    expect(() => I18n.formatNumber(1, "en-US", { style: "currency", currency: "USD" }))
      .toThrow(expect.objectContaining({ code: "UNSUPPORTED_SURFACE", operation: "i18n.formatNumber" }));
    expect(() => I18n.formatNumber(1, "en-US", { style: "currency", currency: "usd" }))
      .toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
  });
  it.each(["NumberFormat", "DateTimeFormat"])("reports missing %s resolvedOptions", constructor => {
    class WithoutResolvedOptions {}
    vi.stubGlobal("Intl", partialIntl({ [constructor]: WithoutResolvedOptions }));
    expect(() => I18n.formatNumber(1, "en-US", decimal))
      .toThrow(expect.objectContaining({ code: "UNSUPPORTED_SURFACE" }));
  });
  it.each(["NumberFormat", "DateTimeFormat"])("requires %s format only when displaying that kind", constructor => {
    class WithoutFormat {
      resolvedOptions(): { locale: string } { return { locale: "en-US" }; }
    }
    vi.stubGlobal("Intl", partialIntl({ [constructor]: WithoutFormat }));
    expect(I18n.translate("key", "en-US", { resources: {}, onMissing: "key" })).toBe("key");
    if (constructor === "NumberFormat") {
      expect(() => I18n.formatNumber(1, "en-US", decimal))
        .toThrow(expect.objectContaining({ code: "UNSUPPORTED_SURFACE", operation: "i18n.formatNumber" }));
      expect(I18n.formatDate("2024-02-29", "en-US", dateOnly)).toBe("February 29, 2024");
    } else {
      expect(() => I18n.formatDate("2024-02-29", "en-US", dateOnly))
        .toThrow(expect.objectContaining({ code: "UNSUPPORTED_SURFACE", operation: "i18n.formatDate" }));
      expect(I18n.formatNumber(1, "en-US", decimal)).toBe("1");
    }
  });
  it("preserves invalid-locale validation before optional capability checks", () => {
    vi.stubGlobal("Intl", undefined);
    expect(() => I18n.formatNumber(1, "en_US", decimal))
      .toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
  });
  it("does not reclassify Intl range errors or swallow unexpected host failures", () => {
    vi.stubGlobal("Intl", partialIntl({ getCanonicalLocales: () => { throw new RangeError("bad locale"); } }));
    expect(() => I18n.formatNumber(1, "en-US", decimal))
      .toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
    const cause = new Error("unexpected host failure");
    vi.stubGlobal("Intl", partialIntl({ getCanonicalLocales: () => { throw cause; } }));
    expect(() => I18n.formatNumber(1, "en-US", decimal)).toThrow(cause);
  });
});
