import { z } from "zod";
import { Diagnostics } from "./diagnostics.js";
import { entityRefSchema } from "./entity-reference.js";
import { VbdError } from "./errors.js";
import { runtimeSnapshot } from "./configuration-values.js";
import { contextSchema } from "./platform.js";
import { identifierSchema, parseInput } from "./validation.js";

const keySchema = z.object({
  namespace: identifierSchema, key: identifierSchema, record: entityRefSchema.optional()
}).strict();
const optionsSchema = z.object({
  context: contextSchema.optional(),
  duplicate: z.enum(["reject", "return-busy"]).default("reject")
}).strict();
export type OperationLockKey = z.input<typeof keySchema>;
export type OperationLockOptions = z.input<typeof optionsSchema>;
export interface CompletedLockResult<T> { status: "completed"; value: T }
export interface BusyLockResult { status: "busy" }

const locks = new Map<string, object>();
function withLock<T>(
  key: OperationLockKey, operation: () => T | PromiseLike<T>,
  options?: OperationLockOptions & { duplicate?: "reject" }
): Promise<CompletedLockResult<Awaited<T>>>;
function withLock<T>(
  key: OperationLockKey, operation: () => T | PromiseLike<T>,
  options: OperationLockOptions
): Promise<CompletedLockResult<Awaited<T>> | BusyLockResult>;
async function withLock<T>(
  input: OperationLockKey, operation: () => T | PromiseLike<T>, settings: OperationLockOptions = {}
): Promise<CompletedLockResult<Awaited<T>> | BusyLockResult> {
  const key = parseInput(keySchema, input, "execution.withLock");
  const options = parseInput(optionsSchema, settings, "execution.withLock");
  if (typeof operation !== "function") throw new VbdError("INVALID_ARGUMENT", { operation: "execution.withLock" });
  const snapshot = runtimeSnapshot(options.context);
  const identity = JSON.stringify([
    snapshot.scope, key.namespace, key.key, key.record?.entityType ?? null, key.record?.id ?? null
  ]);
  snapshot.check();
  if (locks.has(identity)) {
    if (options.duplicate === "return-busy") return { status: "busy" };
    throw new VbdError("RESOURCE_BUSY", { operation: "execution.withLock" });
  }
  if (locks.size >= 128) throw new VbdError("LIMIT_EXCEEDED", { operation: "execution.withLock" });
  const owner = Object.freeze({});
  locks.set(identity, owner);
  try {
    const settled = await Promise.resolve().then(async (): Promise<Awaited<T>> => {
      snapshot.check();
      return await operation();
    }).then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
    try { snapshot.check(); }
    catch (cause) {
      throw new VbdError("CONFIG_EXPIRED", {
        operation: "execution.withLock",
        cause: { scope: cause, ...(settled.ok ? {} : { operation: settled.error }) }
      });
    }
    if (!settled.ok) throw Diagnostics.normalizeError(settled.error, { operation: "execution.withLock" });
    return { status: "completed", value: settled.value };
  } finally {
    if (locks.get(identity) === owner) locks.delete(identity);
  }
}
export const Execution = Object.freeze({ withLock });
