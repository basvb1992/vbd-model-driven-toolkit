import { z } from "zod";
import { Context, gridOf } from "./context.js";
import type { EntityRef } from "./entity-reference.js";
import { Diagnostics } from "./diagnostics.js";
import type { Diagnostic } from "./diagnostics.js";
import { messageForCode, VbdError } from "./errors.js";
import {
  assertRuntimeStructure, copyRuntimeJson, runtimePredicate, runtimeSnapshot
} from "./configuration-values.js";
import { plain, safeKey } from "./data-core.js";
import { contextSchema } from "./platform.js";
import type { ReadContext } from "./platform.js";
import { registration } from "./registrations.js";
import type { Disposable } from "./registrations.js";
import { call, requireMethod, resultOf } from "./sdk.js";
import type { SdkObject } from "./sdk.js";
import { isRecord, logicalNameSchema, parseInput } from "./validation.js";

export interface GridOperation<T> {
  kind: "read" | "mutation";
  run(record: Readonly<EntityRef>): unknown | PromiseLike<unknown>;
  validate(value: unknown): value is T;
}
export interface GridRunOptions {
  allowedTables: readonly string[];
  selectedReferences?: readonly unknown[];
  entityType?: string;
  min?: number;
  max?: number;
  allowMixedTables?: boolean;
  failurePolicy?: "stop" | "continue";
  maxResultBytes?: number;
  context?: ReadContext;
  signal?: Readonly<Pick<AbortSignal, "aborted">>;
}
export type GridStopReason = "none" | "failure" | "cancelled" | "resultLimit" | "scopeChanged" | "contextError";
export type GridRunItem<T> =
  | { record: Readonly<EntityRef>; status: "succeeded"; value: T }
  | { record: Readonly<EntityRef>; status: "failed" | "uncertain"; error: Readonly<Diagnostic>; readonly diagnostic?: VbdError }
  | { record: Readonly<EntityRef>; status: "skipped"; reason: Exclude<GridStopReason, "none"> };
export interface GridRunResult<T> {
  status: "succeeded" | "partial" | "failed" | "uncertain" | "cancelled" | "limited";
  stopReason: GridStopReason;
  items: GridRunItem<T>[];
  counts: { requested: number; attempted: number; succeeded: number; failed: number; uncertain: number; skipped: number };
  resultBytes: number;
}
const operationSchema = z.object({
  kind: z.enum(["read", "mutation"]),
  run: z.custom<GridOperation<unknown>["run"]>(value => typeof value === "function"),
  validate: z.custom<(value: unknown) => boolean>(value => typeof value === "function")
}).strict();
const runOptions = z.object({
  allowedTables: z.array(logicalNameSchema.transform(value => value.toLowerCase())).min(1).max(20),
  selectedReferences: z.array(z.unknown()).max(1000).optional(),
  entityType: logicalNameSchema.optional(),
  min: z.number().int().min(1).max(1000).default(1),
  max: z.number().int().min(1).max(1000).default(100),
  allowMixedTables: z.boolean().default(false),
  failurePolicy: z.enum(["stop", "continue"]).default("stop"),
  maxResultBytes: z.number().int().min(1).max(2_097_152).default(1_048_576),
  context: contextSchema.optional(),
  signal: z.custom<GridRunOptions["signal"]>(value =>
    isRecord(value) && typeof value.aborted === "boolean").optional()
}).strict();
function optionStructure(input: unknown): void {
  if (!isRecord(input) || !plain(input)) throw new VbdError("INVALID_ARGUMENT", { operation: "grids.options" });
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !safeKey(key)) throw new VbdError("INVALID_ARGUMENT", { operation: "grids.options" });
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new VbdError("INVALID_ARGUMENT", { operation: "grids.options" });
    }
    // Explicit native cancellation and trusted read adapters are opaque capabilities.
    if (key !== "context" && key !== "signal") assertRuntimeStructure(descriptor.value);
  }
}
function failure<T>(record: Readonly<EntityRef>, kind: "failed" | "uncertain", cause: unknown): GridRunItem<T> {
  const diagnostic = Diagnostics.normalizeError(cause, { operation: "grids.runSelected" });
  const item: GridRunItem<T> = {
    record, status: kind,
    error: Object.freeze({
      code: diagnostic.code, message: messageForCode(diagnostic.code),
      operation: "grids.runSelected", correlationId: diagnostic.correlationId
    })
  };
  Object.defineProperty(item, "diagnostic", { value: diagnostic, enumerable: false });
  return item;
}
const running = new WeakSet<SdkObject>();
let activeRuns = 0;
export async function runSelected<T>(
  input: unknown, operation: GridOperation<T>, settings: GridRunOptions
): Promise<GridRunResult<T>> {
  assertRuntimeStructure(operation);
  optionStructure(settings);
  const job = parseInput(operationSchema, operation, "grids.runSelected");
  const options = parseInput(runOptions, settings, "grids.runSelected");
  if (options.min > options.max || new Set(options.allowedTables).size !== options.allowedTables.length) {
    throw new VbdError("INVALID_ARGUMENT", { operation: "grids.runSelected" });
  }
  const grid = gridOf(input), getGrid = grid.getGrid;
  const refs = Context.getSelection(Context.fromGridCommand(grid, options.selectedReferences, options.entityType));
  if (refs.length < options.min || refs.length > options.max ||
      refs.some(ref => !options.allowedTables.includes(ref.entityType)) ||
      (!options.allowMixedTables && new Set(refs.map(ref => ref.entityType)).size > 1)) {
    throw new VbdError("INVALID_ARGUMENT", { operation: "grids.selection" });
  }
  const records = Object.freeze(refs.map(ref => Object.freeze({ ...ref })));
  const snapshot = runtimeSnapshot(options.context);
  if (running.has(grid)) throw new VbdError("RESOURCE_BUSY", { operation: "grids.runSelected" });
  if (activeRuns >= 8) throw new VbdError("LIMIT_EXCEEDED", { operation: "grids.runSelected" });
  running.add(grid);
  activeRuns++;
  const items: GridRunItem<T>[] = [];
  let attempted = 0, resultBytes = 0, stopReason: GridStopReason = "none";
  const check = () => {
    snapshot.check();
    if (gridOf(input) !== grid || grid.getGrid !== getGrid) {
      throw new VbdError("CONFIG_EXPIRED", { operation: "grids.context" });
    }
  };
  const cancelled = () => {
    if (!options.signal) return false;
    const value: unknown = options.signal.aborted;
    if (typeof value !== "boolean") throw new VbdError("INVALID_ARGUMENT", { operation: "grids.cancellation" });
    return value;
  };
  try {
    for (const record of records) {
      if (stopReason !== "none") {
        items.push({ record, status: "skipped", reason: stopReason });
        continue;
      }
      try { check(); if (cancelled()) stopReason = "cancelled"; }
      catch (cause) {
        stopReason = cause instanceof VbdError && cause.code === "CONFIG_EXPIRED" ? "scopeChanged" : "contextError";
        items.push(failure(record, "failed", cause));
        continue;
      }
      if (stopReason !== "none") {
        items.push({ record, status: "skipped", reason: stopReason });
        continue;
      }
      let phase: "operation" | "scope" | "output" = "operation";
      try {
        const run = job.run;
        attempted++;
        const raw: unknown = await run(record);
        phase = "scope";
        check();
        phase = "output";
        const canonical = copyRuntimeJson(raw);
        const encoded = JSON.stringify(canonical), candidate = copyRuntimeJson(canonical);
        try { runtimePredicate(job.validate, candidate); }
        finally { phase = "scope"; check(); phase = "output"; }
        if (JSON.stringify(copyRuntimeJson(candidate)) !== encoded) {
          throw new VbdError("CONFIG_VALUE_INVALID", { operation: "grids.guard" });
        }
        const bytes = new TextEncoder().encode(encoded).byteLength;
        if (resultBytes + bytes > options.maxResultBytes) {
          throw new VbdError("LIMIT_EXCEEDED", { operation: "grids.resultBudget" });
        }
        phase = "scope";
        check();
        resultBytes += bytes;
        // The synchronous guard proved this unchanged, isolated JSON value.
        items.push({ record, status: "succeeded", value: canonical as T });
      } catch (cause) {
        let reportCause = cause;
        try { check(); }
        catch (contextFailure) {
          stopReason = contextFailure instanceof VbdError && contextFailure.code === "CONFIG_EXPIRED" ? "scopeChanged" : "contextError";
          reportCause = new VbdError(stopReason === "scopeChanged" ? "CONFIG_EXPIRED" : "OPERATION_FAILED", {
            operation: "grids.context", cause: { cause, contextFailure }
          });
        }
        items.push(failure(record, job.kind === "mutation" ? "uncertain" : "failed", reportCause));
        if (stopReason !== "none") continue;
        if (cause instanceof VbdError && cause.code === "CONFIG_EXPIRED") stopReason = "scopeChanged";
        else if (phase === "scope") stopReason = "contextError";
        else if (phase === "output" && cause instanceof VbdError && cause.code === "LIMIT_EXCEEDED") stopReason = "resultLimit";
        else if (options.failurePolicy === "stop") stopReason = "failure";
      }
    }
    const count = (status: GridRunItem<T>["status"]) => items.filter(item => item.status === status).length;
    const counts = {
      requested: records.length, attempted, succeeded: count("succeeded"), failed: count("failed"),
      uncertain: count("uncertain"), skipped: count("skipped")
    };
    const status = counts.succeeded === records.length ? "succeeded" : counts.succeeded > 0 ? "partial"
      : counts.uncertain > 0 ? "uncertain" : stopReason === "cancelled" ? "cancelled"
        : stopReason === "resultLimit" ? "limited" : "failed";
    return { status, stopReason, items, counts, resultBytes };
  } finally { running.delete(grid); activeRuns--; }
}

export type GridLoadHandler = (executionContext: unknown) => void;
interface LoadEntry { token: Disposable; state: "adding" | "active" | "uncertain"; invoking: boolean }
const loads = new WeakMap<SdkObject, Map<GridLoadHandler, LoadEntry>>();
function voidResult(value: unknown): void {
  if (value === undefined) return;
  // Observe invalid asynchronous returns while reporting the synchronous contract failure.
  void Promise.resolve(value).catch(() => undefined);
  throw new VbdError("DATA_RESPONSE_INVALID", { operation: "grids.onLoad" });
}
export function registerOnLoad(input: unknown, handler: GridLoadHandler): Disposable {
  if (typeof handler !== "function") throw new VbdError("INVALID_ARGUMENT", { operation: "grids.registerOnLoad" });
  const grid = gridOf(input), getGrid = grid.getGrid;
  const current = () => {
    if (gridOf(input) !== grid || grid.getGrid !== getGrid ||
        resultOf(z.union([z.literal(1), z.literal(2)]), call(grid, "getGridType")) !== 2) {
      throw new VbdError("UNSUPPORTED_SURFACE", { operation: "grids.subgrid" });
    }
  };
  current();
  const add = requireMethod(grid, "addOnLoad"), remove = requireMethod(grid, "removeOnLoad");
  let handlers = loads.get(grid);
  if (!handlers) { handlers = new Map(); loads.set(grid, handlers); }
  const existing = handlers.get(handler);
  if (existing) {
    if (existing.state === "adding") throw new VbdError("RESOURCE_BUSY", { operation: "grids.registerOnLoad" });
    if (existing.state === "uncertain") {
      throw new VbdError("PARTIAL_FAILURE", { operation: "grids.registerOnLoad", cause: { disposable: existing.token } });
    }
    return existing.token;
  }
  if (handlers.size >= 100) throw new VbdError("LIMIT_EXCEEDED", { operation: "grids.registerOnLoad" });
  const entries = handlers;
  const wrapper = (executionContext: unknown): void => {
    if (entries.get(handler) !== entry) return;
    try {
      if (entry.state === "uncertain") {
        throw new VbdError("PARTIAL_FAILURE", { operation: "grids.onLoad", cause: { disposable: entry.token } });
      }
      current();
      if (call(executionContext, "getEventSource") !== grid) {
        throw new VbdError("INVALID_ARGUMENT", { operation: "grids.onLoadSource" });
      }
      if (entry.invoking) throw new VbdError("EVENT_REENTRY", { operation: "grids.onLoad" });
      entry.invoking = true;
      try { voidResult(handler(executionContext)); }
      finally { entry.invoking = false; }
    } catch (cause) {
      if (cause instanceof VbdError) throw cause;
      throw new VbdError("OPERATION_FAILED", { operation: "grids.onLoad", cause });
    }
  };
  const token = registration("gridLoad", () => {
    if (entry.state === "adding") throw new VbdError("RESOURCE_BUSY", { operation: "grids.dispose" });
    voidResult(remove(wrapper));
    entries.delete(handler);
  });
  const entry: LoadEntry = { token, state: "adding", invoking: false };
  handlers.set(handler, entry);
  try { voidResult(add(wrapper)); entry.state = "active"; }
  catch (cause) {
    entry.state = "uncertain";
    try { token.dispose(); }
    catch (cleanupFailure) {
      throw new VbdError("PARTIAL_FAILURE", {
        operation: "grids.registerOnLoad", cause: { cause, cleanupFailure, disposable: token }
      });
    }
    throw cause;
  }
  return token;
}
