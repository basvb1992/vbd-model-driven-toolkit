import { VbdError } from "./errors.js";
import { globalContext, sdkObject, call } from "./sdk.js";
import { environmentRoot, guidSchema, parseInput } from "./validation.js";
import { byteLimit, integer, invalid, keysOnly, limit, locale, oneOf, record, safeKey, text } from "./i18n-core.js";
import { formatDate, formatNumber } from "./i18n-format.js";
export type { NumberFormatOptions, DateFormatOptions, DateStyle, TimeStyle } from "./i18n-format.js";

export interface LanguageContext {
  readonly environmentUrl: string;
  readonly userId: string;
  readonly languageId: number;
}
export interface LanguageOptions {
  readonly context?: LanguageContext;
  /** Caller-approved exact LCID mappings, never a heuristic language lookup. */
  readonly localeMap?: readonly { readonly languageId: number; readonly locale: string }[];
}
export interface LanguageInfo {
  readonly source: "native" | "supplied";
  readonly scope: { readonly environmentUrl: string; readonly userId: string };
  readonly languageId: number;
  readonly locale: string | null;
  readonly localeEvidence: "approved-exact-map" | "unmapped";
}

function getLanguage(input: LanguageOptions = {}): LanguageInfo {
  const operation = "i18n.getLanguage", options = record(input, operation);
  keysOnly(options, ["context", "localeMap"], operation);
  let context: Record<string, unknown>;
  const supplied = Object.hasOwn(options, "context");
  if (supplied) {
    context = record(options.context, operation);
    keysOnly(context, ["environmentUrl", "userId", "languageId"], operation);
  } else {
    const native = globalContext(), user = sdkObject(native.userSettings);
    context = { environmentUrl: call(native, "getClientUrl"), userId: user.userId, languageId: user.languageId };
  }
  const environmentUrl = environmentRoot(context.environmentUrl).origin;
  const userId = parseInput(guidSchema, context.userId, operation);
  const languageId = integer(context.languageId, 1, 65535, operation);
  let mapped: string | null = null;
  if (Object.hasOwn(options, "localeMap")) {
    const entries = options.localeMap;
    if (!Array.isArray(entries)) return invalid(operation);
    if (entries.length > 64) return limit(operation);
    const seen = new Set<number>();
    // Use descriptors so sparse arrays/accessor entries cannot execute code.
    const arrayKeys = Reflect.ownKeys(entries);
    if (arrayKeys.length !== entries.length + 1) return invalid(operation);
    for (let index = 0; index < entries.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(entries, String(index));
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return invalid(operation);
      const entry = record(descriptor.value, operation);
      keysOnly(entry, ["languageId", "locale"], operation);
      const id = integer(entry.languageId, 1, 65535, operation), tag = locale(entry.locale, operation);
      if (seen.has(id)) return invalid(operation);
      seen.add(id);
      if (id === languageId) mapped = tag;
    }
  }
  return {
    source: supplied ? "supplied" : "native", scope: { environmentUrl, userId }, languageId,
    locale: mapped, localeEvidence: mapped === null ? "unmapped" : "approved-exact-map"
  };
}

export type TranslationScalar = string | number | boolean;
export type TranslationResources = Readonly<Record<string, Readonly<Record<string, string>>>>;
export type TranslationOptions = {
  readonly resources: TranslationResources;
  readonly values?: Readonly<Record<string, TranslationScalar>>;
} & (
  | { readonly onMissing: "error" | "key" }
  | { readonly onMissing: "fallback"; readonly fallbackLocale: string }
);

function resourceKey(input: unknown, operation: string): string {
  const key = text(input, operation, 128);
  if (!/^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(key) || !safeKey(key)) return invalid(operation);
  return key;
}
function placeholders(template: string, operation: string): Set<string> {
  const names = new Set<string>();
  const remainder = template.replace(/\{([A-Za-z][A-Za-z0-9_]{0,63})\}/g, (_whole: string, name: string) => {
    if (!safeKey(name)) return invalid(operation);
    names.add(name);
    return "";
  });
  if (/[{}]/.test(remainder)) return invalid(operation);
  if (names.size > 64) return limit(operation);
  return names;
}
function resources(input: unknown, operation: string): Record<string, Record<string, string>> {
  const source = record(input, operation, 16);
  const copy: Record<string, Record<string, string>> = Object.create(null) as Record<string, Record<string, string>>;
  let nodes = 1;
  for (const [language, dictionary] of Object.entries(source)) {
    if (locale(language, operation) !== language) return invalid(operation);
    const entries = record(dictionary, operation, 256);
    const target: Record<string, string> = Object.create(null) as Record<string, string>;
    if (++nodes + Object.keys(entries).length > 2048) return limit(operation);
    nodes += Object.keys(entries).length;
    for (const [key, value] of Object.entries(entries)) {
      resourceKey(key, operation);
      const template = text(value, operation);
      placeholders(template, operation);
      target[key] = template;
    }
    copy[language] = target;
  }
  byteLimit(copy, 262_144, operation);
  return copy;
}
function translate(key: string, language: string, input: TranslationOptions): string {
  const operation = "i18n.translate", tag = locale(language, operation);
  resourceKey(key, operation);
  const options = record(input, operation);
  const policy = oneOf(options.onMissing, ["error", "key", "fallback"], operation);
  keysOnly(options, ["resources", "values", "onMissing", ...(policy === "fallback" ? ["fallbackLocale"] : [])], operation);
  const fallback = policy === "fallback" ? locale(options.fallbackLocale, operation) : undefined;
  if (fallback === tag) return invalid(operation);
  const dictionaries = resources(options.resources, operation);
  if (fallback !== undefined && !Object.hasOwn(dictionaries, fallback)) return invalid(operation);
  const values = Object.hasOwn(options, "values") ? record(options.values, operation, 64) : record({}, operation);
  for (const [name, value] of Object.entries(values)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)) return invalid(operation);
    if (typeof value === "string") text(value, operation);
    else if (typeof value !== "boolean" && !(typeof value === "number" && Number.isFinite(value))) return invalid(operation);
  }
  byteLimit(values, 65_536, operation);
  let template = dictionaries[tag]?.[key];
  if (template === undefined && fallback !== undefined) template = dictionaries[fallback]?.[key];
  if (template === undefined) {
    if (policy !== "key") throw new VbdError("RESOURCE_NOT_FOUND", { operation });
    if (Object.keys(values).length !== 0) return invalid(operation);
    return key;
  }
  const names = placeholders(template, operation);
  if (names.size !== Object.keys(values).length || [...names].some(name => !Object.hasOwn(values, name))) {
    return invalid(operation);
  }
  let length = template.length;
  for (const match of template.matchAll(/\{([A-Za-z][A-Za-z0-9_]{0,63})\}/g)) {
    const name = match[1];
    if (name === undefined) return invalid(operation);
    length += String(values[name]).length - match[0].length;
  }
  if (length > 16_384) return limit(operation);
  const output = template.replace(/\{([A-Za-z][A-Za-z0-9_]{0,63})\}/g,
    (_whole: string, name: string) => String(values[name]));
  byteLimit(output, 65_536, operation);
  return output;
}

export const I18n = Object.freeze({ getLanguage, translate, formatDate, formatNumber });
