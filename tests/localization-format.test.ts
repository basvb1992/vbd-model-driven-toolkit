import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { I18n } from "../src/i18n.js";
import type { DateFormatOptions, NumberFormatOptions } from "../src/i18n.js";

const decimal = { style: "decimal" } as const;
const dateOnly = { behavior: "dateOnly", dateStyle: "long" } as const;
const independent = { behavior: "timeZoneIndependent", dateStyle: "long", timeStyle: "short" } as const;
const local = { behavior: "userLocal", dateStyle: "long", timeStyle: "short", timeZone: "America/New_York" } as const;

describe("explicit exact Intl locales", () => {
  it.each(["", "en_US", " en-US", "en-US ", "zz-ZZ", "en-XX", "en-US-x-private", "en-US-u-nu-arab", "x-test", 1033, null])(
    "rejects invalid/unsupported/fallback-only locales for every formatting/translation API: %j", language => {
      expect(() => I18n.formatNumber(1, language as string, decimal)).toThrow();
      expect(() => I18n.formatDate("2024-02-29", language as string, dateOnly)).toThrow();
      expect(() => I18n.translate("key", language as string, { resources: {}, onMissing: "key" })).toThrow();
    });
  it("canonicalizes casing without switching the requested language or region", () => {
    expect(I18n.formatNumber(1234.5, "de-de", decimal)).toBe("1.234,5");
    expect(I18n.formatNumber(1234.5, "en-us", decimal)).toBe("1,234.5");
    expect(I18n.formatDate("2024-02-29", "en-gb", dateOnly)).toBe("29 February 2024");
  });
});

describe("finite display numbers and constrained options", () => {
  it("preserves zero/negative zero, applies grouping and percent semantics without coercion", () => {
    expect(I18n.formatNumber(0, "en-US", decimal)).toBe("0");
    expect(I18n.formatNumber(-0, "en-US", decimal)).toBe("-0");
    expect(I18n.formatNumber(1234.5, "en-US", { ...decimal, useGrouping: false })).toBe("1234.5");
    expect(I18n.formatNumber(0.125, "en-US", { style: "percent", maximumFractionDigits: 1 })).toBe("12.5%");
    expect(I18n.formatNumber(-1234.5, "de-DE", { ...decimal, minimumFractionDigits: 2 })).toBe("-1.234,50");
  });
  it("formats explicitly supported currencies with code/symbol and locale-specific minor units", () => {
    const usd = I18n.formatNumber(1234.5, "en-US", { style: "currency", currency: "USD", currencyDisplay: "code" });
    expect(usd.replace(/\s/gu, " ")).toBe("USD 1,234.50");
    expect(I18n.formatNumber(1234.5, "en-US", { style: "currency", currency: "USD", currencyDisplay: "symbol" }))
      .toBe("$1,234.50");
    expect(I18n.formatNumber(1234.5, "ja-JP", { style: "currency", currency: "JPY", currencyDisplay: "code" })
      .replace(/\s/gu, " ")).toBe("JPY 1,235");
    expect(I18n.formatNumber(1.25, "de-DE", { style: "currency", currency: "EUR", currencyDisplay: "code" })
      .replace(/\s/gu, " ")).toBe("1,25 EUR");
  });
  it("enforces fraction thresholds 0..20 and their ordering, retaining explicit zero options", () => {
    expect(I18n.formatNumber(1.9, "en-US", { ...decimal, minimumFractionDigits: 0, maximumFractionDigits: 0 })).toBe("2");
    expect(I18n.formatNumber(1, "en-US", { ...decimal, minimumFractionDigits: 20, maximumFractionDigits: 20 }))
      .toBe("1." + "0".repeat(20));
    expect(I18n.formatNumber(1, "en-US", { ...decimal, minimumFractionDigits: 5 })).toBe("1.00000");
    expect(I18n.formatNumber(1.5, "en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })).toBe("$2");
  });
  it.each([NaN, Infinity, -Infinity, "1", null, undefined, {}, new Number(1), 1n])(
    "rejects non-finite/non-number values without valueOf: %s", value => {
      expect(() => I18n.formatNumber(value as number, "en-US", decimal)).toThrow();
    });
  it.each([
    {}, { style: "unit", unit: "meter" }, { style: "decimal", currency: "USD" },
    { style: "decimal", useGrouping: "auto" }, { style: "decimal", notation: "compact" },
    { style: "decimal", minimumFractionDigits: -1 }, { style: "decimal", maximumFractionDigits: 21 },
    { style: "decimal", minimumFractionDigits: 1.5 }, { style: "decimal", maximumFractionDigits: NaN },
    { style: "decimal", minimumFractionDigits: 3, maximumFractionDigits: 2 },
    { style: "decimal", minimumFractionDigits: undefined },
    { style: "currency" }, { style: "currency", currency: "usd" }, { style: "currency", currency: "ZZZ" },
    { style: "currency", currency: "USD", currencyDisplay: "name" }
  ])("rejects unsupported/invalid numeric options: %j", options => {
    expect(() => I18n.formatNumber(1, "en-US", options as NumberFormatOptions)).toThrow();
  });
  it("does not execute option accessors or scalar coercion hooks", () => {
    const execute = vi.fn(() => "decimal");
    const options = Object.defineProperty({}, "style", { get: execute, enumerable: true });
    expect(() => I18n.formatNumber(1, "en-US", options as NumberFormatOptions)).toThrow();
    expect(() => I18n.formatNumber({ valueOf: execute } as never, "en-US", decimal)).toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("bounded explicit date behaviors", () => {
  it("formats real date-only calendars without a user timezone shift", () => {
    expect(I18n.formatDate("2024-02-29", "en-GB", dateOnly)).toBe("29 February 2024");
    expect(I18n.formatDate("2000-02-29", "en-GB", dateOnly)).toBe("29 February 2000");
    expect(I18n.formatDate("2025-12-31", "en-GB", dateOnly)).toBe("31 December 2025");
    expect(I18n.formatDate("2026-01-01", "en-GB", dateOnly)).toBe("1 January 2026");
    expect(I18n.formatDate("0099-01-01", "en-GB", dateOnly)).toBe("1 January 99");
    expect(I18n.formatDate("0001-01-01", "en-GB", dateOnly)).toBe("1 January 1");
    expect(I18n.formatDate("9999-12-31", "en-GB", dateOnly)).toBe("31 December 9999");
  });
  it.each(["2023-02-29", "1900-02-29", "2024-02-30", "2024-04-31", "2024-00-01",
    "2024-13-01", "2024-01-00", "0000-01-01", "10000-01-01", "2024-2-29",
    "2024-02-29T00:00:00Z", "2024-02-29 ", new Date("2024-02-29"), 0, null])(
    "rejects noncanonical/noncalendar date-only input: %j", value => {
      expect(() => I18n.formatDate(value as string, "en-GB", dateOnly)).toThrow();
    });
  it("preserves independent wall clock during DST gaps, overlaps and year boundaries", () => {
    expect(I18n.formatDate("2024-03-10T02:30:00", "en-GB", independent)).toBe("10 March 2024 at 02:30");
    expect(I18n.formatDate("2024-11-03T01:30:00.123", "en-GB", independent)).toBe("3 November 2024 at 01:30");
    expect(I18n.formatDate("2025-12-31T23:59:59.999", "en-GB", independent)).toBe("31 December 2025 at 23:59");
    expect(I18n.formatDate("2026-01-01T00:00:00", "en-GB", independent)).toBe("1 January 2026 at 00:00");
  });
  it.each(["2024-02-29", "2024-02-29T12:00", "2024-02-29T12:00:00Z", "2024-02-29T12:00:00+01:00",
    "2024-02-29T24:00:00", "2024-02-29T23:60:00", "2024-02-29T23:59:60",
    "2024-02-30T12:00:00", "2024-02-29T12:00:00.1", new Date("2024-02-29")])(
    "rejects ambiguous/shiftable/invalid independent inputs: %j", value => {
      expect(() => I18n.formatDate(value as string, "en-GB", independent)).toThrow();
    });
  it("converts actual instants in explicit zones across year boundaries", () => {
    const instant = new Date("2026-01-01T00:30:00Z");
    expect(I18n.formatDate(instant, "en-GB", local)).toBe("31 December 2025 at 19:30");
    expect(I18n.formatDate(instant, "en-GB", { ...local, timeZone: "Asia/Tokyo" })).toBe("1 January 2026 at 09:30");
    expect(I18n.formatDate(instant, "en-GB", { ...local, timeZone: "UTC" })).toBe("1 January 2026 at 00:30");
  });
  it("applies spring DST transitions and distinguishes overlap instants by zone display", () => {
    const before = I18n.formatDate(new Date("2024-03-10T06:59:00Z"), "en-GB", local);
    const after = I18n.formatDate(new Date("2024-03-10T07:01:00Z"), "en-GB", local);
    expect(before).toBe("10 March 2024 at 01:59");
    expect(after).toBe("10 March 2024 at 03:01");
    const summer = I18n.formatDate(new Date("2024-11-03T05:30:00Z"), "en-GB", { ...local, timeStyle: "long" });
    const winter = I18n.formatDate(new Date("2024-11-03T06:30:00Z"), "en-GB", { ...local, timeStyle: "long" });
    expect(summer).toContain("3 November 2024 at 01:30:00");
    expect(winter).toContain("3 November 2024 at 01:30:00");
    expect(summer).not.toBe(winter);
    const summerZone = new Intl.DateTimeFormat("en-GB", {
      timeZone: local.timeZone, dateStyle: "long", timeStyle: "long", calendar: "gregory", numberingSystem: "latn"
    })
      .formatToParts(new Date("2024-11-03T05:30:00Z")).find(part => part.type === "timeZoneName")?.value;
    expect(summerZone).toBeTruthy();
    expect(summer).toContain(summerZone);
  });
  it("accepts cross-realm Dates and ignores malicious getTime/valueOf overrides", () => {
    const foreign = runInNewContext('new Date("2024-02-29T12:34:00Z")') as Date;
    expect(foreign instanceof Date).toBe(false);
    expect(I18n.formatDate(foreign, "en-GB", { ...local, timeZone: "UTC" })).toBe("29 February 2024 at 12:34");
    const execute = vi.fn(() => { throw new Error("must not execute"); });
    foreign.getTime = execute;
    foreign.valueOf = execute;
    expect(I18n.formatDate(foreign, "en-GB", { ...local, timeZone: "UTC" })).toBe("29 February 2024 at 12:34");
    expect(execute).not.toHaveBeenCalled();
    expect(() => I18n.formatDate({ getTime: () => 0 } as Date, "en-GB", local)).toThrow();
  });
  it.each([new Date(NaN), "2024-02-29T00:00:00Z", 0, null, {}, undefined])(
    "requires a valid actual Date for userLocal: %j", value => {
      expect(() => I18n.formatDate(value as Date, "en-GB", local)).toThrow();
    });
  it.each([
    { ...local, timeZone: undefined }, { ...local, timeZone: "browser" },
    { ...local, timeZone: "Pacific Standard Time" }, { ...local, timeZone: "+01:00" },
    { ...local, timeZone: "Mars/Olympus" }, { ...local, timeZone: "UTC " },
    { ...dateOnly, timeZone: "UTC" }, { ...dateOnly, timeStyle: "short" },
    { ...independent, timeZone: "UTC" }, { ...independent, timeStyle: "full" },
    { behavior: "userLocal", timeZone: "UTC" }, { behavior: "dateOnly", dateStyle: "unknown" },
    { ...dateOnly, calendar: "buddhist" }, { ...local, hour12: true }
  ])("rejects unsupported date options and absent/Windows/invalid zones: %j", options => {
    expect(() => I18n.formatDate(new Date(0), "en-GB", options as DateFormatOptions)).toThrow();
  });
});
