import { z } from "zod";
import { VbdError } from "./errors.js";
import { isRecord } from "./validation.js";

export type SdkObject = Record<string, unknown>;
export const nameSchema = z.string().min(1).max(256).refine(value => value.trim().length > 0);
export const messageSchema = z.string().min(1).max(8192);
export const formTypeSchema = z.union([
  z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(6)
]);
export function sdkObject(value: unknown): SdkObject {
  if (!isRecord(value) || Array.isArray(value)) {
    throw new VbdError("UNSUPPORTED_SURFACE", { operation: "sdk.context" });
  }
  return value;
}
export function sdkRoot(path: readonly string[]): SdkObject {
  let value: unknown = Reflect.get(globalThis, "Xrm");
  for (const key of path) value = sdkObject(value)[key];
  return sdkObject(value);
}
export function hasMethod(target: unknown, name: string): boolean {
  return isRecord(target) && typeof target[name] === "function";
}
export function requireMethod(target: unknown, name: string): (...args: unknown[]) => unknown {
  const owner = sdkObject(target);
  const method = owner[name];
  if (typeof method !== "function") {
    throw new VbdError("UNSUPPORTED_SURFACE", { operation: "sdk.method", cause: { method: name } });
  }
  return (...args) => {
    try {
      const result: unknown = Reflect.apply(method, owner, args);
      return result;
    } catch (cause) {
      if (cause instanceof VbdError) throw cause;
      throw new VbdError("SDK_OPERATION_FAILED", { operation: "sdk.invoke", cause });
    }
  };
}
export function call(target: unknown, name: string, ...args: unknown[]): unknown {
  return requireMethod(target, name)(...args);
}
export async function callAsync(target: unknown, name: string, ...args: unknown[]): Promise<unknown> {
  try {
    const pending = call(target, name, ...args);
    if (!isRecord(pending) || typeof pending.then !== "function") {
      throw new VbdError("DATA_RESPONSE_INVALID", { operation: "sdk.response" });
    }
    return await pending;
  }
  catch (cause) {
    if (cause instanceof VbdError) throw cause;
    throw new VbdError("SDK_OPERATION_FAILED", { operation: "sdk.invoke", cause });
  }
}
export function resultOf<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw new VbdError("DATA_RESPONSE_INVALID", { operation: "sdk.response" });
  return result.data;
}
export function collectionItems(collection: unknown, maximum = 1000): unknown[] {
  const input = Array.isArray(collection) ? collection : call(collection, "get");
  if (!Array.isArray(input)) throw new VbdError("DATA_RESPONSE_INVALID", { operation: "sdk.collection" });
  if (input.length > maximum) throw new VbdError("LIMIT_EXCEEDED", { operation: "sdk.collection" });
  return [...input];
}
export function globalContext(): SdkObject {
  return sdkObject(call(sdkRoot(["Utility"]), "getGlobalContext"));
}
export function partial<T>(
  operations: readonly { key: string; run: () => T }[]
): T[] {
  const completed: string[] = [], results: T[] = [];
  for (const operation of operations) {
    try {
      results.push(operation.run());
      completed.push(operation.key);
    } catch (cause) {
      if (completed.length === 0) throw cause;
      throw new VbdError("PARTIAL_FAILURE", {
        operation: "sdk.group",
        cause: { completed, failed: operation.key, cause }
      });
    }
  }
  return results;
}
