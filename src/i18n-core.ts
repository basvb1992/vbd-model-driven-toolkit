import { VbdError } from "./errors.js";

/** Internal validation helpers; not namespace APIs. */
export function invalid(operation: string): never {
  throw new VbdError("INVALID_ARGUMENT", { operation });
}
export function limit(operation: string): never {
  throw new VbdError("LIMIT_EXCEEDED", { operation });
}
const objectSource = Function.prototype.toString.call(Object);
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
export function safeKey(key: string): boolean {
  return !forbidden.has(key);
}

/** Snapshot enumerable own data properties, never evaluate accessors/toJSON. */
export function record(input: unknown, operation: string, maximum = 32): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return invalid(operation);
  const prototype: unknown = Object.getPrototypeOf(input);
  if (prototype !== null) {
    if (typeof prototype !== "object" || Object.getPrototypeOf(prototype) !== null) return invalid(operation);
    const constructor: unknown = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
    if (typeof constructor !== "function" ||
        Object.getOwnPropertyDescriptor(constructor, "prototype")?.value !== prototype ||
        Function.prototype.toString.call(constructor) !== objectSource) return invalid(operation);
  }
  const keys = Reflect.ownKeys(input);
  if (keys.length > maximum) return limit(operation);
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== "string" || !safeKey(key)) return invalid(operation);
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return invalid(operation);
    copy[key] = descriptor.value;
  }
  return copy;
}
export function keysOnly(value: Record<string, unknown>, allowed: readonly string[], operation: string): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid(operation);
}
export function text(value: unknown, operation: string, maximum = 4096): string {
  if (typeof value !== "string") return invalid(operation);
  if (value.length > maximum) return limit(operation);
  // Reject malformed UTF-16 rather than have encoders replace it silently.
  if (/[\ud800-\udfff]/u.test(value)) return invalid(operation);
  return value;
}
export function oneOf<const T extends readonly string[]>(value: unknown, values: T, operation: string): T[number] {
  if (typeof value !== "string" || !values.includes(value)) return invalid(operation);
  return value;
}
export function finite(value: unknown, operation: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return invalid(operation);
  return value;
}
export function integer(value: unknown, minimum: number, maximum: number, operation: string): number {
  const number = finite(value, operation);
  if (!Number.isInteger(number) || number < minimum || number > maximum) return invalid(operation);
  return number;
}
export function intl<T>(operation: string, run: () => T): T {
  try {
    return run();
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;
    throw new VbdError("INVALID_ARGUMENT", { operation, cause });
  }
}

export function unsupportedIntl(operation: string): never {
  throw new VbdError("UNSUPPORTED_SURFACE", { operation });
}
/** Optional host capability: inspect only at method use, never at module load. */
export function intlApi(
  operation: string,
  methods: readonly ("getCanonicalLocales" | "NumberFormat" | "DateTimeFormat" | "supportedValuesOf")[]
): typeof Intl {
  const api: unknown = Reflect.get(globalThis, "Intl");
  if (typeof api !== "object" || api === null ||
      methods.some(method => typeof Reflect.get(api, method) !== "function")) return unsupportedIntl(operation);
  return api as typeof Intl;
}

/** Deliberately small BCP47 subset; lookup support alone would permit fallback. */
export function locale(input: unknown, operation: string): string {
  if (typeof input !== "string" || input.length > 35 ||
      !/^[A-Za-z]{2,3}(?:-[A-Za-z]{4})?(?:-(?:[A-Za-z]{2}|\d{3}))?$/.test(input)) return invalid(operation);
  const api = intlApi(operation, ["getCanonicalLocales", "NumberFormat", "DateTimeFormat"]);
  return intl(operation, () => {
    const canonical = api.getCanonicalLocales(input)[0];
    if (!canonical) return invalid(operation);
    const number = new api.NumberFormat(canonical, { localeMatcher: "lookup" });
    const date = new api.DateTimeFormat(canonical, { localeMatcher: "lookup" });
    if (typeof number.resolvedOptions !== "function" || typeof date.resolvedOptions !== "function") {
      return unsupportedIntl(operation);
    }
    if (number.resolvedOptions().locale !== canonical || date.resolvedOptions().locale !== canonical) {
      return invalid(operation);
    }
    return canonical;
  });
}

export function byteLimit(value: unknown, maximum: number, operation: string): void {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > maximum) limit(operation);
}
