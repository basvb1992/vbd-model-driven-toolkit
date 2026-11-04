import { z } from "zod";
import { Diagnostics } from "./diagnostics.js";
import type { Diagnostic } from "./diagnostics.js";
import { messageForCode, VbdError } from "./errors.js";
import type { ErrorCode } from "./errors.js";
import {
  assertRuntimeStructure, copyRuntimeJson, runtimePredicate, runtimeSnapshot
} from "./configuration-values.js";
import { contextSchema } from "./platform.js";
import type { ReadContext } from "./platform.js";
import { identifierSchema, isRecord, parseInput } from "./validation.js";

export interface ReadBatchRequest<T> {
  id: string;
  kind: "read";
  run(): unknown | PromiseLike<unknown>;
  validate(value: unknown): value is T;
}
export interface ReadBatchOptions {
  context?: ReadContext;
  concurrency?: number;
  failurePolicy?: "stop" | "continue";
  maxResultBytes?: number;
  /** Stops new dispatch; does not abort a native request already in flight. */
  signal?: Readonly<Pick<AbortSignal, "aborted">>;
}
export type BatchStopReason = "none" | "failure" | "cancelled" | "resultLimit";
export type ReadBatchItem<T> =
  | { id: string; status: "succeeded"; value: T }
  | { id: string; status: "failed"; error: Readonly<Diagnostic>; readonly diagnostic?: VbdError }
  | { id: string; status: "skipped"; reason: Exclude<BatchStopReason, "none"> };
export interface ReadBatchResult<T> {
  status: "succeeded" | "partial" | "failed" | "cancelled" | "limited";
  stopReason: BatchStopReason;
  items: ReadBatchItem<T>[];
  counts: { total: number; attempted: number; succeeded: number; failed: number; skipped: number };
  resultBytes: number;
}
const requestSchema = z.object({
  id: identifierSchema, kind: z.literal("read"),
  run: z.custom<() => unknown>(value => typeof value === "function"),
  validate: z.custom<(value: unknown) => boolean>(value => typeof value === "function")
}).strict();
const optionsSchema = z.object({
  context: contextSchema.optional(),
  concurrency: z.number().int().min(1).max(8).default(4),
  failurePolicy: z.enum(["stop", "continue"]).default("stop"),
  maxResultBytes: z.number().int().min(1).max(2_097_152).default(1_048_576),
  signal: z.custom<Readonly<Pick<AbortSignal, "aborted">>>(value =>
    isRecord(value) && typeof value.aborted === "boolean").optional()
}).strict();
let activeBatches = 0;
function failure(id: string, cause: unknown): ReadBatchItem<never> {
  const diagnostic = Diagnostics.normalizeError(cause, { operation: "batch.execute" });
  const item: ReadBatchItem<never> = {
    id, status: "failed", error: Object.freeze({
      code: diagnostic.code, message: messageForCode(diagnostic.code),
      operation: "batch.execute", correlationId: diagnostic.correlationId
    })
  };
  Object.defineProperty(item, "diagnostic", { value: diagnostic, enumerable: false });
  return item;
}
async function execute<T>(
  input: readonly ReadBatchRequest<T>[], settings: ReadBatchOptions = {}
): Promise<ReadBatchResult<T>> {
  let requests: z.output<typeof requestSchema>[], options: z.output<typeof optionsSchema>;
  try {
    assertRuntimeStructure(input);
    requests = parseInput(z.array(requestSchema).min(1).max(1000), input, "batch.execute");
    options = parseInput(optionsSchema, settings, "batch.execute");
  } catch (cause) {
    if (cause instanceof VbdError) throw cause;
    throw new VbdError("INVALID_ARGUMENT", { operation: "batch.execute", cause });
  }
  if (new Set(requests.map(item => item.id.toLowerCase())).size !== requests.length) {
    throw new VbdError("INVALID_ARGUMENT", { operation: "batch.execute" });
  }
  const snapshot = runtimeSnapshot(options.context);
  if (activeBatches >= 8) throw new VbdError("LIMIT_EXCEEDED", { operation: "batch.execute" });
  activeBatches++;
  try {
    const results = new Array<ReadBatchItem<T> | undefined>(requests.length).fill(undefined);
    let next = 0, attempted = 0, resultBytes = 0;
    const state: { stopReason: BatchStopReason } = { stopReason: "none" };
    let fatal: { code: ErrorCode; cause: unknown } | undefined;
    const check = () => {
      try { snapshot.check(); }
      catch (cause) {
        fatal ??= { code: "CONFIG_EXPIRED", cause };
        throw cause;
      }
    };
    const cancellation = () => {
      if (!options.signal) return;
      try {
        const aborted: unknown = options.signal.aborted;
        if (typeof aborted !== "boolean") {
          throw new VbdError("INVALID_ARGUMENT", { operation: "batch.cancellation" });
        }
        if (aborted && state.stopReason === "none") state.stopReason = "cancelled";
      } catch (cause) {
        fatal ??= { code: "OPERATION_FAILED", cause };
        throw cause;
      }
    };
    async function worker(): Promise<void> {
      while (!fatal) {
        try { cancellation(); check(); }
        catch { return; }
        if (state.stopReason !== "none" || next >= requests.length) return;
        const index = next++, request = requests[index];
        if (!request) throw new VbdError("DATA_RESPONSE_INVALID", { operation: "batch.dispatch" });
        let phase: "operation" | "output" | "guard" = "operation";
        let invoked = false;
        try {
          check();
          const run = request.run;
          attempted++;
          invoked = true;
          const raw: unknown = await run();
          check();
          phase = "output";
          const canonical = copyRuntimeJson(raw);
          const encoded = JSON.stringify(canonical);
          phase = "guard";
          const candidate = copyRuntimeJson(canonical);
          try { runtimePredicate(request.validate, candidate); }
          finally { check(); }
          if (JSON.stringify(copyRuntimeJson(candidate)) !== encoded) {
            throw new VbdError("CONFIG_VALUE_INVALID", { operation: "batch.guard" });
          }
          check();
          const bytes = new TextEncoder().encode(encoded).byteLength;
          if (resultBytes + bytes > options.maxResultBytes) {
            if (state.stopReason === "none") state.stopReason = "resultLimit";
            throw new VbdError("LIMIT_EXCEEDED", { operation: "batch.resultBudget" });
          }
          resultBytes += bytes;
          // The synchronous guard proved this unchanged, isolated JSON value.
          results[index] = { id: request.id, status: "succeeded", value: canonical as T };
        } catch (cause) {
          if (invoked) results[index] = failure(request.id, cause);
          if (phase === "output" && cause instanceof VbdError && cause.code === "LIMIT_EXCEEDED") {
            if (state.stopReason === "none") state.stopReason = "resultLimit";
          } else if (options.failurePolicy === "stop" && state.stopReason === "none") state.stopReason = "failure";
        }
        try { cancellation(); check(); }
        catch { return; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(options.concurrency, requests.length) }, worker));
    try { cancellation(); check(); } catch { /* Report the captured fatal failure after draining started workers. */ }
    if (fatal) {
      throw new VbdError(fatal.code, {
        operation: "batch.execute", cause: {
          cause: fatal.cause, total: requests.length, attempted,
          operationFailures: results.flatMap(item =>
            item?.status === "failed" ? [{ id: item.id, diagnostic: item.diagnostic }] : [])
        }
      });
    }
    const items = results.map((item, index): ReadBatchItem<T> => {
      if (item) return item;
      const request = requests[index];
      if (!request || state.stopReason === "none") {
        throw new VbdError("DATA_RESPONSE_INVALID", { operation: "batch.results" });
      }
      return { id: request.id, status: "skipped", reason: state.stopReason };
    });
    const succeeded = items.filter(item => item.status === "succeeded").length;
    const failed = items.filter(item => item.status === "failed").length;
    const skipped = items.filter(item => item.status === "skipped").length;
    return {
      status: state.stopReason === "cancelled" ? "cancelled" : state.stopReason === "resultLimit" ? "limited"
        : failed ? succeeded ? "partial" : "failed" : "succeeded",
      stopReason: state.stopReason, items, counts: { total: requests.length, attempted, succeeded, failed, skipped }, resultBytes
    };
  } finally { activeBatches--; }
}
export const Batch = Object.freeze({ execute });
