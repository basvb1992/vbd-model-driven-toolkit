import { finite, integer, intl, invalid, keysOnly, locale, oneOf, record } from "./i18n-core.js";

interface FractionOptions {
  readonly useGrouping?: boolean;
  readonly minimumFractionDigits?: number;
  readonly maximumFractionDigits?: number;
}
export type NumberFormatOptions = FractionOptions & (
  | { readonly style: "decimal" | "percent" }
  | { readonly style: "currency"; readonly currency: string; readonly currencyDisplay?: "code" | "symbol" }
);
export type DateStyle = "short" | "medium" | "long" | "full";
export type TimeStyle = "short" | "medium" | "long";
export type DateFormatOptions =
  | { readonly behavior: "dateOnly"; readonly dateStyle: DateStyle }
  | { readonly behavior: "timeZoneIndependent"; readonly dateStyle: DateStyle; readonly timeStyle?: TimeStyle }
  | { readonly behavior: "userLocal"; readonly dateStyle: DateStyle; readonly timeStyle?: TimeStyle; readonly timeZone: string };

export function numberFormatter(language: string, input: NumberFormatOptions): Intl.NumberFormat {
  const operation = "i18n.formatNumber", tag = locale(language, operation);
  const options = record(input, operation);
  const style = oneOf(options.style, ["decimal", "percent", "currency"], operation);
  keysOnly(options, ["style", "useGrouping", "minimumFractionDigits", "maximumFractionDigits",
    ...(style === "currency" ? ["currency", "currencyDisplay"] : [])], operation);
  const native: Intl.NumberFormatOptions = { style, localeMatcher: "lookup" };
  if (Object.hasOwn(options, "useGrouping")) {
    if (typeof options.useGrouping !== "boolean") return invalid(operation);
    native.useGrouping = options.useGrouping;
  }
  if (Object.hasOwn(options, "minimumFractionDigits")) {
    native.minimumFractionDigits = integer(options.minimumFractionDigits, 0, 20, operation);
  }
  if (Object.hasOwn(options, "maximumFractionDigits")) {
    native.maximumFractionDigits = integer(options.maximumFractionDigits, 0, 20, operation);
  }
  if (native.minimumFractionDigits !== undefined && native.maximumFractionDigits !== undefined &&
      native.minimumFractionDigits > native.maximumFractionDigits) return invalid(operation);
  if (style === "currency") {
    if (typeof options.currency !== "string" || !/^[A-Z]{3}$/.test(options.currency) ||
        !Intl.supportedValuesOf("currency").includes(options.currency)) return invalid(operation);
    native.currency = options.currency;
    if (Object.hasOwn(options, "currencyDisplay")) {
      native.currencyDisplay = oneOf(options.currencyDisplay, ["code", "symbol"], operation);
    }
  }
  return intl(operation, () => new Intl.NumberFormat(tag, native));
}

export function formatNumber(value: number, language: string, options: NumberFormatOptions): string {
  return numberFormatter(language, options).format(finite(value, "i18n.formatNumber"));
}

export function dateFormatter(language: string, input: DateFormatOptions): {
  formatter: Intl.DateTimeFormat; behavior: DateFormatOptions["behavior"];
} {
  const operation = "i18n.formatDate", tag = locale(language, operation);
  const options = record(input, operation);
  const behavior = oneOf(options.behavior, ["dateOnly", "timeZoneIndependent", "userLocal"], operation);
  keysOnly(options, ["behavior", "dateStyle", ...(behavior === "dateOnly" ? [] : ["timeStyle"]),
    ...(behavior === "userLocal" ? ["timeZone"] : [])], operation);
  const native: Intl.DateTimeFormatOptions = {
    localeMatcher: "lookup", calendar: "gregory", numberingSystem: "latn", timeZone: "UTC",
    dateStyle: oneOf(options.dateStyle, ["short", "medium", "long", "full"], operation)
  };
  if (Object.hasOwn(options, "timeStyle")) {
    native.timeStyle = oneOf(options.timeStyle, ["short", "medium", "long"], operation);
  }
  if (behavior === "userLocal") {
    if (typeof options.timeZone !== "string" || options.timeZone.length > 100 ||
        !(options.timeZone === "UTC" || /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){1,2}$/.test(options.timeZone))) {
      return invalid(operation);
    }
    native.timeZone = options.timeZone;
  }
  return { behavior, formatter: intl(operation, () => new Intl.DateTimeFormat(tag, native)) };
}

function calendarMilliseconds(input: unknown, independent: boolean): number {
  const operation = "i18n.formatDate";
  if (typeof input !== "string") return invalid(operation);
  const match = (independent
    ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?$/
    : /^(\d{4})-(\d{2})-(\d{2})$/).exec(input);
  if (!match) return invalid(operation);
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const hour = Number(match[4] ?? 0), minute = Number(match[5] ?? 0);
  const second = Number(match[6] ?? 0), millisecond = Number(match[7] ?? 0);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31 ||
      hour > 23 || minute > 59 || second > 59) return invalid(operation);
  // UTC is only a carrier for the explicitly supplied calendar/wall clock.
  // setUTCFullYear avoids Date.UTC's special interpretation of years 00..99.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millisecond);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return invalid(operation);
  }
  return date.getTime();
}

function instantMilliseconds(input: unknown): number {
  const operation = "i18n.formatDate";
  // Intrinsic brand check accepts foreign-realm Dates and never calls overrides.
  let time: unknown;
  try {
    time = Reflect.apply(Date.prototype.getTime, input, []);
  } catch (cause) {
    if (!(cause instanceof TypeError)) throw cause;
    return invalid(operation);
  }
  return finite(time, operation);
}

export function formatDate(value: string | Date, language: string, options: DateFormatOptions): string {
  const { formatter, behavior } = dateFormatter(language, options);
  const time = behavior === "userLocal" ? instantMilliseconds(value)
    : calendarMilliseconds(value, behavior === "timeZoneIndependent");
  return formatter.format(time);
}
