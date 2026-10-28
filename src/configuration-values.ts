import { jsonValue, plain, safeKey } from "./data-core.js";
import type { JsonValue } from "./data-core.js";
import { environmentGeneration } from "./environment.js";
import { VbdError } from "./errors.js";
import { readScope, resolveReadContext, scopeKey } from "./platform.js";
import type { ReadContext } from "./platform.js";

/** Internal preflight: reject accessors before a schema or the shared JSON copier reads values. */
export function assertRuntimeStructure(input: unknown): void {
  let count = 0;
  const ancestors = new Set<object>();
  const visit = (value: unknown, depth: number): void => {
    if (++count > 10_000 || depth > 8) runtimeFail("LIMIT_EXCEEDED");
    if (value === null || typeof value !== "object") return;
    if ((!Array.isArray(value) && !plain(value)) || ancestors.has(value)) runtimeFail();
    ancestors.add(value);
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === "length") continue;
      if (typeof key !== "string" || !safeKey(key)) runtimeFail();
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (!property || !("value" in property) || !property.enumerable) runtimeFail();
      visit(property.value, depth + 1);
    }
    ancestors.delete(value);
  };
  visit(input, 0);
}

export function copyRuntimeJson(input: unknown, maximumBytes = 262_144): JsonValue {
  assertRuntimeStructure(input);
  const result = jsonValue(input);
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > maximumBytes) {
    runtimeFail("LIMIT_EXCEEDED");
  }
  return result;
}

export function runtimeFail(code: "INVALID_ARGUMENT" | "LIMIT_EXCEEDED" | "CONFIG_EXPIRED" |
  "CONFIG_VALUE_INVALID" | "CONFIG_NOT_FOUND" | "CONFIG_VALUE_MISSING" = "INVALID_ARGUMENT"): never {
  throw new VbdError(code, { operation: "configuration.runtime" });
}

/** Guards are synchronous. Observe invalid async returns, including rejecting then methods. */
export function runtimePredicate(validate: (value: unknown) => boolean, value: unknown): void {
  let accepted: unknown;
  try {
    accepted = validate(value);
  } catch (cause) {
    throw new VbdError("CONFIG_VALUE_INVALID", { operation: "configuration.validateValue", cause });
  }
  if (accepted === true) return;
  if (accepted !== null && (typeof accepted === "object" || typeof accepted === "function")) {
    try {
      const then: unknown = Reflect.get(accepted, "then");
      if (typeof then === "function") {
        const ignore = () => undefined;
        void Promise.resolve().then(() => {
          const returned: unknown = Reflect.apply(then, accepted, [ignore, ignore]);
          try { Reflect.apply(Promise.prototype.then, returned, [ignore, ignore]); }
          catch { /* A then method need not return a native promise. */ }
        }).catch(ignore);
      }
    } catch (cause) {
      throw new VbdError("CONFIG_VALUE_INVALID", { operation: "configuration.validateValue", cause });
    }
  }
  runtimeFail("CONFIG_VALUE_INVALID");
}

export function runtimeSnapshot(supplied?: ReadContext): {
  context: ReadContext; scope: string; generation: number; check(): void;
} {
  const context = resolveReadContext(supplied);
  const scope = scopeKey(readScope(context));
  const generation = environmentGeneration();
  return {
    context, scope, generation,
    check: () => {
      if (scopeKey(readScope(context)) !== scope || environmentGeneration() !== generation) {
        runtimeFail("CONFIG_EXPIRED");
      }
    }
  };
}
