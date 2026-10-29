import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { Utils } from "../src/utils.js";
import { I18n } from "../src/i18n.js";
import type { DisplayValue, ValueFormatOptions } from "../src/utils.js";

const settings: ValueFormatOptions = { locale: "en-GB", nulls: { policy: "label", label: "(none)" } };
const ref = { entityType: "account", id: "11111111-2222-3333-4444-555555555555" };

describe("typed display dispatch only", () => {
  it("keeps the public scalar, discriminant and fallback contracts checked by TypeScript", () => {
    // @ts-expect-error Numeric display never accepts numeric strings.
    expect(() => I18n.formatNumber("1", "en-US", { style: "decimal" })).toThrow();
    // @ts-expect-error Currency requires an explicit code.
    expect(() => I18n.formatNumber(1, "en-US", { style: "currency" })).toThrow();
    // @ts-expect-error Fallback policy requires an explicit fallback locale.
    expect(() => I18n.translate("key", "en-US", { resources: {}, onMissing: "fallback" })).toThrow();
    // @ts-expect-error A boolean display value cannot be a string.
    expect(() => Utils.formatValue({ kind: "boolean", value: "false", labels: { true: "Yes", false: "No" } }, settings)).toThrow();
  });
  it("preserves text/empty/false/zero values and explicit empty labels", () => {
    expect(Utils.formatValue({ kind: "text", value: "" }, settings)).toBe("");
    expect(Utils.formatValue({ kind: "text", value: "<b>literal</b>" }, settings)).toBe("<b>literal</b>");
    expect(Utils.formatValue({ kind: "boolean", value: false, labels: { true: "Yes", false: "" } }, settings)).toBe("");
    expect(Utils.formatValue({ kind: "boolean", value: true, labels: { true: "Yes", false: "No" } }, settings)).toBe("Yes");
    expect(Utils.formatValue({ kind: "number", value: 0, format: { style: "decimal" } }, settings)).toBe("0");
    expect(Utils.formatValue({ kind: "choice", value: 0, labels: [{ value: 0, label: "" }] }, settings)).toBe("");
  });
  it("reuses I18n numeric and date display options, including foreign-realm instants", () => {
    const format = { style: "currency", currency: "EUR", minimumFractionDigits: 3 } as const;
    expect(Utils.formatValue({ kind: "number", value: 1234.5, format }, settings))
      .toBe(I18n.formatNumber(1234.5, settings.locale, format));
    const independent = { behavior: "timeZoneIndependent", dateStyle: "long", timeStyle: "short" } as const;
    expect(Utils.formatValue({ kind: "date", value: "2024-03-10T02:30:00", format: independent }, settings))
      .toBe("10 March 2024 at 02:30");
    expect(Utils.formatValue({ kind: "date", value: "2024-02-29", format: { behavior: "dateOnly", dateStyle: "long" } }, settings))
      .toBe("29 February 2024");
    const foreign = runInNewContext('new Date("2026-01-01T00:30:00Z")') as Date;
    expect(Utils.formatValue({ kind: "date", value: foreign,
      format: { behavior: "userLocal", dateStyle: "long", timeStyle: "short", timeZone: "America/New_York" } }, settings))
      .toBe("31 December 2025 at 19:30");
  });
  it("requires exact caller-supplied reference identity and choice labels, never guessing metadata", () => {
    expect(Utils.formatValue({ kind: "reference", value: ref, label: {
      reference: { entityType: "ACCOUNT", id: `{${ref.id.toUpperCase()}}` }, text: "Supplied display"
    } }, settings)).toBe("Supplied display");
    expect(ref).toEqual({ entityType: "account", id: "11111111-2222-3333-4444-555555555555" });
    for (const labelled of [{ ...ref, entityType: "contact" }, { ...ref, id: "22222222-2222-3333-4444-555555555555" }]) {
      expect(() => Utils.formatValue({ kind: "reference", value: ref, label: { reference: labelled, text: "Wrong" } }, settings)).toThrow();
    }
    expect(Utils.formatValue({ kind: "choice", value: -1, labels: [{ value: -1, label: "Exact choice" }] }, settings)).toBe("Exact choice");
    expect(() => Utils.formatValue({ kind: "choice", value: 1, labels: [{ value: 0, label: "Not 1" }] }, settings)).toThrow();
  });
  it("handles null explicitly for every supported kind, rejecting undefined and preserving empty null labels", () => {
    const values: DisplayValue[] = [
      { kind: "text", value: null }, { kind: "boolean", value: null, labels: { true: "Yes", false: "No" } },
      { kind: "number", value: null, format: { style: "decimal" } },
      { kind: "date", value: null, format: { behavior: "dateOnly", dateStyle: "long" } },
      { kind: "reference", value: null, label: { reference: ref, text: "label" } },
      { kind: "choice", value: null, labels: [] }
    ];
    for (const value of values) {
      expect(Utils.formatValue(value, settings)).toBe("(none)");
      expect(Utils.formatValue(value, { ...settings, nulls: { policy: "label", label: "" } })).toBe("");
      expect(() => Utils.formatValue(value, { ...settings, nulls: { policy: "error" } })).toThrow();
      expect(() => Utils.formatValue({ ...value, value: undefined } as never, settings)).toThrow();
    }
  });
  it.each([
    { kind: "text", value: 0 }, { kind: "text", value: false }, { kind: "text" },
    { kind: "boolean", value: 0, labels: { true: "Yes", false: "No" } },
    { kind: "boolean", value: false, labels: { true: "Yes" } },
    { kind: "number", value: "1", format: { style: "decimal" } },
    { kind: "number", value: Infinity, format: { style: "decimal" } },
    { kind: "number", value: null, format: { style: "decimal", maximumFractionDigits: 21 } },
    { kind: "date", value: null, format: { behavior: "userLocal", dateStyle: "long" } },
    { kind: "date", value: "2023-02-29", format: { behavior: "dateOnly", dateStyle: "long" } },
    { kind: "reference", value: ref }, { kind: "reference", value: [ref], label: { reference: ref, text: "x" } },
    { kind: "choice", value: "0", labels: [{ value: 0, label: "zero" }] },
    { kind: "choice", value: 0, labels: [{ value: 0, label: "a" }, { value: 0, label: "b" }] },
    { kind: "choice", value: 0.1, labels: [{ value: 0, label: "a" }] },
    { kind: "choice", value: 2147483648, labels: [{ value: 2147483648, label: "a" }] },
    { kind: "choice", value: 0, labels: [{ value: 0, label: 0 }] },
    { kind: "choice", value: 0, labels: new Array(1) },
    { kind: "multichoice", value: [1], labels: [] },
    { kind: "text", value: "x", html: true }
  ])("rejects unsupported/coerced/ambiguous dispatcher inputs: %j", input => {
    expect(() => Utils.formatValue(input as DisplayValue, settings)).toThrow();
  });
  it("validates locale/null policy even for empty, text and null displays", () => {
    for (const options of [{ locale: "en-XX", nulls: settings.nulls }, { locale: "en-US" },
      { locale: "en-US", nulls: { policy: "label" } }, { ...settings, nulls: { policy: "auto" } },
      { ...settings, nulls: { policy: "error", label: "hidden" } }, { ...settings, fallbackLocale: "en-US" }]) {
      expect(() => Utils.formatValue({ kind: "text", value: "" }, options as ValueFormatOptions)).toThrow();
      expect(() => Utils.formatValue({ kind: "text", value: null }, options as ValueFormatOptions)).toThrow();
    }
  });
  it("bounds labels and text and never executes input, label or reference getters", () => {
    const getter = vi.fn(() => "bad");
    for (const input of [
      Object.defineProperty({ kind: "text" }, "value", { get: getter, enumerable: true }),
      { kind: "boolean", value: false, labels: Object.defineProperty({ true: "Yes" }, "false", { get: getter, enumerable: true }) },
      { kind: "reference", value: Object.defineProperty({ entityType: "account" }, "id", { get: getter, enumerable: true }),
        label: { reference: ref, text: "label" } },
      { kind: "choice", value: 0, labels: Object.defineProperty([], "0", { get: getter, enumerable: true }) }
    ]) expect(() => Utils.formatValue(input as DisplayValue, settings)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(Utils.formatValue({ kind: "text", value: "x".repeat(4096) }, settings)).toHaveLength(4096);
    expect(() => Utils.formatValue({ kind: "text", value: "x".repeat(4097) }, settings)).toThrow();
    const labels = Array.from({ length: 256 }, (_, value) => ({ value, label: String(value) }));
    expect(Utils.formatValue({ kind: "choice", value: 255, labels }, settings)).toBe("255");
    expect(() => Utils.formatValue({ kind: "choice", value: 0, labels: [...labels, { value: 256, label: "256" }] }, settings)).toThrow();
  });
  it("preserves existing scalar helpers and their cross-realm Date behavior", () => {
    expect(Object.keys(Utils).sort()).toEqual([
      "compareValues", "escapeODataLiteral", "escapeXml", "formatValue", "isGuid", "normalizeGuid", "parseNumber", "toEntityRef"
    ]);
    expect(Utils.normalizeGuid(`{${ref.id.toUpperCase()}}`)).toBe(ref.id);
    expect(Utils.isGuid(ref.id)).toBe(true);
    expect(Utils.toEntityRef("ACCOUNT", ref.id)).toEqual(ref);
    expect(Utils.escapeODataLiteral("O'Brien", "string")).toBe("'O''Brien'");
    expect(Utils.escapeODataLiteral(false, "boolean")).toBe("false");
    expect(Utils.escapeODataLiteral(0, "number")).toBe("0");
    expect(Utils.escapeXml("<&")).toBe("&lt;&amp;");
    expect(Utils.parseNumber("1e2")).toBe(100);
    expect(Utils.compareValues(0, "0", "eq")).toBe(false);
    const date = runInNewContext('new Date("2024-02-29T00:00:00Z")') as Date;
    expect(Utils.escapeODataLiteral(date, "date")).toBe("2024-02-29T00:00:00.000Z");
    expect(Utils.compareValues(date, new Date("2024-02-29T00:00:00Z"), "eq")).toBe(true);
  });
});
