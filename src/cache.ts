import { z } from "zod";
import { VbdError } from "./errors.js";
import { contextSchema } from "./platform.js";
import type { ReadContext } from "./platform.js";
import { identifierSchema, parseInput } from "./validation.js";
import { copyRuntimeJson, runtimeFail, runtimePredicate, runtimeSnapshot } from "./configuration-values.js";
import type { JsonValue } from "./data-core.js";

export interface CacheKey { namespace: string; key: string }
export interface CacheLoadOptions<T> {
  context?: ReadContext;
  approved: true;
  purpose: "configuration" | "metadata";
  /** Caller-controlled schema/source freshness revision; change it when the contract changes. */
  revision: string;
  ttlMs: number;
  maxBytes?: number;
  dependencies?: readonly string[];
  load(): Promise<unknown>;
  validate(value: unknown): value is T;
}
export interface CacheInvalidation {
  namespace: string;
  key?: string;
  dependency?: string;
}
export interface CacheScopeOptions { context?: ReadContext }
const keySchema = z.object({ namespace: identifierSchema, key: identifierSchema }).strict();
const scopeOptions = z.object({ context: contextSchema.optional() }).strict();
const loadOptions = scopeOptions.extend({
  approved: z.literal(true), purpose: z.enum(["configuration", "metadata"]),
  revision: z.string().min(1).max(128), ttlMs: z.number().int().min(1).max(300_000),
  maxBytes: z.number().int().min(1).max(262_144).default(262_144),
  dependencies: z.array(identifierSchema).max(32).default([]),
  load: z.custom<() => Promise<unknown>>(value => typeof value === "function"),
  validate: z.custom<(value: unknown) => boolean>(value => typeof value === "function")
}).strict();
interface Slot {
  scope: string;
  namespace: string;
  key: string;
  dependencies: string[];
  policy: string;
  generation: number;
  pending?: Promise<JsonValue>;
  value?: JsonValue;
  storedAt: number;
  expiresAt: number;
  bytes: number;
}
const slots = new Map<string, Slot>();
let activeLoads = 0;
const maximumSlots = 128;
const maximumTotalBytes = 1_048_576;

function trim(): void {
  let bytes = [...slots.values()].reduce((sum, item) => sum + item.bytes, 0);
  for (const [key, slot] of slots) {
    if (slots.size <= maximumSlots && bytes <= maximumTotalBytes) break;
    slots.delete(key);
    bytes -= slot.bytes;
  }
}

async function getOrLoad<T>(keyInput: CacheKey, input: CacheLoadOptions<T>): Promise<T> {
  const key = parseInput(keySchema, keyInput, "cache.getOrLoad");
  const options = parseInput(loadOptions, input, "cache.getOrLoad");
  if (new Set(options.dependencies).size !== options.dependencies.length) runtimeFail();
  const snapshot = runtimeSnapshot(options.context);
  const identity = JSON.stringify([snapshot.scope, key.namespace, key.key]);
  const policy = JSON.stringify([options.purpose, options.revision, options.ttlMs, options.maxBytes,
    [...options.dependencies].sort()]);
  let slot = slots.get(identity);
  if (slot && (slot.policy !== policy || slot.generation !== snapshot.generation ||
      (!slot.pending && (Date.now() < slot.storedAt || Date.now() >= slot.expiresAt)))) {
    slots.delete(identity);
    slot = undefined;
  }
  if (!slot) {
    if (activeLoads >= 64) runtimeFail("LIMIT_EXCEEDED");
    slot = {
      ...key, scope: snapshot.scope, dependencies: options.dependencies, policy,
      generation: snapshot.generation, storedAt: 0, expiresAt: 0, bytes: 0
    };
    slots.set(identity, slot);
    trim();
  }
  const current = slot;
  const check = () => {
    snapshot.check();
    if (slots.get(identity) !== current) runtimeFail("CONFIG_EXPIRED");
  };
  check();
  if (current.value === undefined && !current.pending) {
    activeLoads++;
    // Install pending before invoking caller code; even synchronous/reentrant loaders coalesce.
    current.pending = Promise.resolve().then(async () => {
      check();
      const loaded = await options.load();
      check();
      return copyRuntimeJson(loaded, options.maxBytes);
    }).finally(() => { activeLoads--; });
  }
  try {
    const value = current.value === undefined ? await current.pending : current.value;
    check();
    const canonical = copyRuntimeJson(value, options.maxBytes);
    // A caller cannot mutate the canonical value by mutating its predicate argument.
    try { runtimePredicate(options.validate, copyRuntimeJson(canonical, options.maxBytes)); }
    finally { check(); }
    if (current.value === undefined) {
      current.value = canonical;
      delete current.pending;
      current.bytes = new TextEncoder().encode(JSON.stringify(canonical)).byteLength;
      current.storedAt = Date.now();
      current.expiresAt = current.storedAt + options.ttlMs;
      trim();
      check();
    } else if (Date.now() < current.storedAt || Date.now() >= current.expiresAt) {
      slots.delete(identity);
      runtimeFail("CONFIG_EXPIRED");
    }
    const output = copyRuntimeJson(canonical, options.maxBytes);
    // The parsed guard has already passed; this local assertion uses that runtime evidence.
    return output as T;
  } catch (cause) {
    const active = slots.get(identity) === current;
    if (active) slots.delete(identity);
    snapshot.check();
    if (!active) runtimeFail("CONFIG_EXPIRED");
    if (cause instanceof VbdError) throw cause;
    throw new VbdError("DATA_READ_FAILED", { operation: "cache.getOrLoad", cause });
  }
}

function invalidate(input: CacheInvalidation, settings: CacheScopeOptions = {}): number {
  const selection = parseInput(z.object({
    namespace: identifierSchema, key: identifierSchema.optional(), dependency: identifierSchema.optional()
  }).strict(), input, "cache.invalidate");
  const options = parseInput(scopeOptions, settings, "cache.invalidate");
  const snapshot = runtimeSnapshot(options.context);
  let removed = 0;
  for (const [identity, slot] of slots) {
    if (slot.scope === snapshot.scope && slot.namespace === selection.namespace &&
        (selection.key === undefined || slot.key === selection.key) &&
        (selection.dependency === undefined || slot.dependencies.includes(selection.dependency))) {
      slots.delete(identity);
      removed++;
    }
  }
  snapshot.check();
  return removed;
}
function clear(settings: CacheScopeOptions = {}): number {
  const options = parseInput(scopeOptions, settings, "cache.clear");
  const snapshot = runtimeSnapshot(options.context);
  let removed = 0;
  for (const [identity, slot] of slots) {
    if (slot.scope === snapshot.scope) {
      slots.delete(identity);
      removed++;
    }
  }
  snapshot.check();
  return removed;
}
export const Cache = Object.freeze({ getOrLoad, invalidate, clear });
