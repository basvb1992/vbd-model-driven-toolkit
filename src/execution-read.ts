import { z } from "zod";
import { assertRuntimeStructure, runtimeSnapshot } from "./configuration-values.js";
import { Diagnostics } from "./diagnostics.js";
import { VbdError } from "./errors.js";
import { contextSchema } from "./platform.js";
import type { ReadContext } from "./platform.js";
import { isRecord, parseInput } from "./validation.js";

/** A trust assertion, not a sandbox or proof that application code is pure. */
export interface ReadCallbackContext {
  readonly attempt: number;
  readonly signal?: AbortSignal;
}
export type ReadOperation<T> = (context: ReadCallbackContext) => T | PromiseLike<T>;
/** Only explicit own data properties on a failure (or an approved wrapper's cause). */
export interface ReadRetryEvidence {
  readonly status: number;
  /** Literal HTTP Retry-After: integer seconds or an IMF-fixdate. */
  readonly retryAfter?: number | string;
}
export interface ReadRetryPolicy {
  readonly maxAttempts?: number;
  readonly initialDelayMs?: number;
  readonly backoffFactor?: number;
  readonly maxDelayMs?: number;
  readonly maxTotalDelayMs?: number;
  readonly maxElapsedMs?: number;
}
export interface ReadRetryOptions<T = unknown> {
  readonly readOnly: true;
  readonly context?: ReadContext;
  readonly signal?: AbortSignal;
  readonly policy?: ReadRetryPolicy;
  /** Synchronous; false, throws and thenables are invalid, never retryable. */
  readonly guard?: (value: T) => boolean;
}
export type PreflightObservation =
  | { readonly status: "pass"; readonly reason: "confirmed" }
  | { readonly status: "fail"; readonly reason: "denied" | "not-satisfied" }
  | { readonly status: "unknown"; readonly reason: "missing-data" | "inconclusive" }
  | { readonly status: "unsupported"; readonly reason: "unavailable" };
export interface PreflightCheck {
  readonly id: string;
  readonly readOnly: true;
  readonly required?: boolean;
  readonly run: ReadOperation<PreflightObservation>;
}
export type PreflightReason = PreflightObservation["reason"] |
  "check-failed" | "invalid-observation" | "cancelled" | "elapsed-budget";
export interface PreflightEvidence {
  readonly id: string;
  readonly required: boolean;
  readonly executed: boolean;
  readonly status: PreflightObservation["status"];
  readonly reason: PreflightReason;
  readonly correlationId?: string;
}
export interface PreflightCheckResult extends PreflightEvidence {
  readonly observer?: "reported" | "failed";
  readonly observerCorrelationId?: string;
  /** Non-enumerable original evidence, never part of the safe JSON projection. */
  readonly diagnostic?: VbdError;
  readonly observerDiagnostic?: VbdError;
}
export interface PreflightOptions {
  readonly context?: ReadContext;
  readonly signal?: AbortSignal;
  readonly concurrency?: number;
  readonly maxElapsedMs?: number;
  /** Trusted read-only diagnostic observer; no messages, navigation or repairs. */
  readonly observer?: (evidence: Readonly<PreflightEvidence>) => void | PromiseLike<void>;
}
export interface PreflightReport {
  readonly status: "ready" | "blocked" | "incomplete";
  readonly basis: "trusted-read-only-checks";
  readonly correlationId: string;
  readonly checks: readonly PreflightCheckResult[];
  readonly counts: Readonly<{
    total: number; executed: number; pass: number; fail: number;
    unknown: number; unsupported: number; observerFailed: number;
  }>;
}

const operationName = "execution.withRetry";
const preflightName = "execution.preflight";
const callback = <T>() => z.custom<T>(value => typeof value === "function");
const signalSchema = z.custom<AbortSignal>(value =>
  isRecord(value) && typeof value.aborted === "boolean" &&
  typeof value.addEventListener === "function" && typeof value.removeEventListener === "function");
const elapsedSchema = z.number().int().min(1).max(300_000);
const policySchema = z.object({
  maxAttempts: z.number().int().min(1).max(10).default(3),
  initialDelayMs: z.number().int().min(0).max(60_000).default(250),
  backoffFactor: z.number().finite().min(1).max(4).default(2),
  maxDelayMs: z.number().int().min(0).max(60_000).default(5_000),
  maxTotalDelayMs: z.number().int().min(0).max(300_000).default(15_000),
  maxElapsedMs: elapsedSchema.default(30_000)
}).strict().refine(value => value.initialDelayMs <= value.maxDelayMs);
const retrySchema = z.object({
  readOnly: z.literal(true), context: contextSchema.optional(), signal: signalSchema.optional(),
  policy: policySchema.default(() => policySchema.parse({})),
  guard: callback<(value: unknown) => boolean>().optional()
}).strict();
const checkSchema = z.object({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9._-]{0,63}$/)
    .refine(value => !["constructor", "prototype", "__proto__"].includes(value)),
  readOnly: z.literal(true), required: z.boolean().default(true),
  run: callback<ReadOperation<PreflightObservation>>()
}).strict();
const checksSchema = z.array(checkSchema).min(1).max(100)
  .refine(value => new Set(value.map(check => check.id)).size === value.length);
const preflightSchema = z.object({
  context: contextSchema.optional(), signal: signalSchema.optional(),
  concurrency: z.number().int().min(1).max(8).default(4),
  maxElapsedMs: elapsedSchema.default(30_000),
  observer: callback<NonNullable<PreflightOptions["observer"]>>().optional()
}).strict();
const observationSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pass"), reason: z.literal("confirmed") }).strict(),
  z.object({ status: z.literal("fail"), reason: z.enum(["denied", "not-satisfied"]) }).strict(),
  z.object({ status: z.literal("unknown"), reason: z.enum(["missing-data", "inconclusive"]) }).strict(),
  z.object({ status: z.literal("unsupported"), reason: z.literal("unavailable") }).strict()
]);

// Shared, page-local admission, deliberately held until all started callbacks drain.
let activeRuns = 0;
function reserve(operation: string): () => void {
  if (activeRuns >= 8) throw new VbdError("LIMIT_EXCEEDED", { operation });
  activeRuns++;
  return () => { activeRuns--; };
}
type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };
async function observe<T>(run: () => T | PromiseLike<T>): Promise<Settled<Awaited<T>>> {
  try { return { ok: true, value: await run() }; }
  catch (error) { return { ok: false, error }; }
}
type Halt = "cancelled" | "elapsed-budget";
class ReadRun {
  private readonly wall = Date.now();
  private readonly monotonic = performance.now();
  private readonly snapshot;
  constructor(
    readonly operation: string, private readonly maximum: number,
    readonly signal: AbortSignal | undefined, context: ReadContext | undefined
  ) { this.snapshot = runtimeSnapshot(context); }
  elapsed(): number {
    // Both clocks matter: browser suspension need not advance performance.now().
    return Math.max(0, Date.now() - this.wall, performance.now() - this.monotonic);
  }
  remaining(): number { return this.maximum - this.elapsed(); }
  scope(evidence?: unknown): void {
    try { this.snapshot.check(); }
    catch (cause) {
      throw new VbdError("CONFIG_EXPIRED", {
        operation: this.operation, cause: { scope: cause, evidence }
      });
    }
  }
  halt(): Halt | undefined {
    return this.signal?.aborted ? "cancelled" : this.remaining() <= 0 ? "elapsed-budget" : undefined;
  }
  check(evidence?: unknown): void {
    this.scope(evidence);
    const reason = this.halt();
    if (reason) throw new VbdError(reason === "cancelled" ? "OPERATION_FAILED" : "LIMIT_EXCEEDED", {
      operation: this.operation, cause: { reason, evidence }
    });
  }
  callbackContext(attempt: number): ReadCallbackContext {
    return Object.freeze({ attempt, ...(this.signal === undefined ? {} : { signal: this.signal }) });
  }
  async delay(milliseconds: number, evidence: unknown): Promise<void> {
    const wall = Date.now(), monotonic = performance.now();
    let remaining = milliseconds;
    while (remaining > 0) {
      this.check(evidence);
      await new Promise<void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let finished = false;
        const finish = (failure?: { cause: unknown }): void => {
          if (finished) return;
          finished = true;
          if (timer !== undefined) clearTimeout(timer);
          let error = failure;
          try { this.signal?.removeEventListener("abort", aborted); }
          catch (cause) { error = { cause: { cleanup: cause, prior: failure?.cause } }; }
          if (error) reject(new VbdError("OPERATION_FAILED", {
            operation: this.operation, cause: { delay: error.cause, evidence }
          }));
          else resolve();
        };
        const aborted = () => { finish(); };
        try {
          timer = setTimeout(() => { finish(); }, Math.min(remaining, this.remaining()));
          this.signal?.addEventListener("abort", aborted, { once: true });
          if (this.signal?.aborted) aborted();
        } catch (cause) { finish({ cause }); }
      });
      this.check(evidence);
      remaining = milliseconds - Math.max(0, Date.now() - wall, performance.now() - monotonic);
    }
    this.check(evidence);
  }
}

/** No getters, text parsing, guessed native error codes or unbounded cause traversal. */
function own(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}
function retryEvidence(error: unknown): ReadRetryEvidence | undefined {
  const visited = new Set<object>();
  let current = error;
  try {
    for (let depth = 0; depth < 8 && isRecord(current) && !visited.has(current); depth++) {
      visited.add(current);
      if (current instanceof VbdError) {
        if (!["DATA_READ_FAILED", "SDK_OPERATION_FAILED", "OPERATION_FAILED"].includes(current.code)) return;
        current = own(current, "cause");
        continue;
      }
      const header = Object.getOwnPropertyDescriptor(current, "retryAfter");
      if (header && !("value" in header)) return;
      const status = own(current, "status"), retryAfter = header?.value as unknown;
      if (typeof status !== "number" || ![408, 429, 502, 503, 504].includes(status)) return;
      if (retryAfter !== undefined && typeof retryAfter !== "number" && typeof retryAfter !== "string") return;
      return { status, ...(retryAfter === undefined ? {} : { retryAfter }) };
    }
  } catch {
    // A hostile reflective/proxy failure is uncertain evidence, never retryable.
    return;
  }
}
function retryAfterDelay(value: number | string, maximum: number): number | undefined {
  let milliseconds: number;
  if (typeof value === "number" || /^\d{1,10}$/.test(value)) {
    const seconds = Number(value);
    if (!Number.isSafeInteger(seconds) || seconds < 0) return;
    milliseconds = seconds * 1000;
  } else {
    if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) return;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || date.toUTCString() !== value) return;
    milliseconds = Math.max(0, date.getTime() - Date.now());
  }
  return Number.isFinite(milliseconds) && milliseconds <= maximum ? milliseconds : undefined;
}

async function validateGuard(
  guard: (value: unknown) => boolean, value: unknown
): Promise<void> {
  let accepted: unknown;
  try { accepted = guard(value); }
  catch (cause) {
    // The caller rechecks scope even if the guard throws.
    throw new VbdError("CONFIG_VALUE_INVALID", { operation: operationName, cause });
  }
  if (accepted === true) return;
  // Invalid async guards are still observed and drained; they never become valid.
  const drained = await observe(() => accepted);
  throw new VbdError("CONFIG_VALUE_INVALID", {
    operation: operationName, ...(drained.ok ? {} : { cause: drained.error })
  });
}

export async function withRetry<T>(
  operation: ReadOperation<T>, settings: ReadRetryOptions<Awaited<T>>
): Promise<Awaited<T>> {
  const options = parseInput(retrySchema, settings, operationName);
  if (typeof operation !== "function") throw new VbdError("INVALID_ARGUMENT", { operation: operationName });
  const release = reserve(operationName);
  try {
    const policy = options.policy;
    const run = new ReadRun(operationName, policy.maxElapsedMs, options.signal, options.context);
    let scheduled = 0;
    // Admission and callback dispatch are distinct scope/cancellation observations.
    await Promise.resolve();
    for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
      run.check();
      const result = await observe(() => {
        run.check();
        return operation(run.callbackContext(attempt));
      });
      run.check(result.ok ? undefined : result.error);
      if (result.ok) {
        const guarded = await observe(async () => {
          run.check();
          if (options.guard) await validateGuard(options.guard, result.value);
        });
        run.check(guarded.ok ? undefined : guarded.error);
        if (!guarded.ok) throw guarded.error;
        return result.value;
      }
      const evidence = retryEvidence(result.error);
      run.check(result.error);
      if (!evidence || attempt === policy.maxAttempts) {
        throw Diagnostics.normalizeError(result.error, { operation: operationName });
      }
      const backoff = Math.min(policy.maxDelayMs,
        Math.ceil(policy.initialDelayMs * policy.backoffFactor ** (attempt - 1)));
      const headerDelay = evidence.retryAfter === undefined ? 0 :
        retryAfterDelay(evidence.retryAfter, policy.maxDelayMs);
      // Never truncate a server wait or retry earlier after invalid header evidence.
      if (headerDelay === undefined) throw Diagnostics.normalizeError(result.error, { operation: operationName });
      const delay = Math.max(backoff, headerDelay);
      if (scheduled + delay > policy.maxTotalDelayMs || delay >= run.remaining()) {
        throw Diagnostics.normalizeError(result.error, { operation: operationName });
      }
      scheduled += delay;
      await run.delay(delay, result.error);
      run.check(result.error);
    }
    throw new VbdError("LIMIT_EXCEEDED", { operation: operationName });
  } catch (cause) {
    throw Diagnostics.normalizeError(cause, { operation: operationName });
  } finally { release(); }
}

function evidenceResult(
  evidence: PreflightEvidence, diagnostic?: VbdError,
  observer?: "reported" | "failed", observerDiagnostic?: VbdError
): PreflightCheckResult {
  const result: PreflightCheckResult = {
    ...evidence, ...(observer === undefined ? {} : { observer }),
    ...(observerDiagnostic === undefined ? {} : { observerCorrelationId: observerDiagnostic.correlationId })
  };
  if (diagnostic) Object.defineProperty(result, "diagnostic", { value: diagnostic });
  if (observerDiagnostic) Object.defineProperty(result, "observerDiagnostic", { value: observerDiagnostic });
  return Object.freeze(result);
}
function unknownResult(
  check: z.output<typeof checkSchema>, reason: PreflightReason, executed: boolean, cause?: unknown
): PreflightCheckResult {
  const diagnostic = new VbdError(reason === "invalid-observation" ? "DATA_RESPONSE_INVALID" : "OPERATION_FAILED", {
    operation: preflightName, cause
  });
  return evidenceResult({
    id: check.id, required: check.required, executed, status: "unknown", reason,
    correlationId: diagnostic.correlationId
  }, diagnostic);
}
export async function preflight(
  input: readonly PreflightCheck[], settings: PreflightOptions = {}
): Promise<PreflightReport> {
  const checks = parseInput(checksSchema, input, preflightName);
  const options = parseInput(preflightSchema, settings, preflightName);
  const release = reserve(preflightName);
  try {
    const run = new ReadRun(preflightName, options.maxElapsedMs, options.signal, options.context);
    const results: (PreflightCheckResult | undefined)[] = new Array(checks.length);
    let next = 0, fatal: VbdError | undefined;
    const scope = (evidence?: unknown): void => {
      try { run.scope(evidence); }
      catch (cause) {
        fatal ??= Diagnostics.normalizeError(cause, { operation: preflightName });
        throw fatal;
      }
    };
    const worker = async (): Promise<void> => {
      while (!fatal && next < checks.length) {
        const index = next++, check = checks[index];
        if (!check) return;
        scope();
        const halt = run.halt();
        if (halt) { results[index] = unknownResult(check, halt, false); continue; }
        let executed = false;
        const settled = await observe(() => {
          scope();
          const stopped = run.halt();
          if (stopped) return undefined;
          executed = true;
          return check.run(run.callbackContext(1));
        });
        scope(settled.ok ? undefined : settled.error);
        const stopped = run.halt();
        let result: PreflightCheckResult;
        if (stopped || !executed) {
          result = unknownResult(check, stopped ?? "elapsed-budget", executed, settled);
        } else if (!settled.ok) {
          result = unknownResult(check, "check-failed", true, settled.error);
        } else {
          const validated = await observe(() => {
            scope();
            assertRuntimeStructure(settled.value);
            return parseInput(observationSchema, settled.value, preflightName);
          });
          scope(validated.ok ? undefined : validated.error);
          const afterGuard = run.halt();
          result = afterGuard ? unknownResult(check, afterGuard, true, validated) :
            validated.ok ? evidenceResult({ id: check.id, required: check.required, executed: true, ...validated.value }) :
              unknownResult(check, "invalid-observation", true, validated.error);
        }
        // Observers see only the safe projection, never retained raw diagnostics.
        if (options.observer && !run.halt() && !fatal) {
          const evidence: PreflightEvidence = Object.freeze({ ...result });
          let observerExecuted = false;
          const reported = await observe(() => {
            scope(result.diagnostic);
            if (run.halt() || fatal) return;
            observerExecuted = true;
            return options.observer?.(evidence);
          });
          scope(reported.ok ? result.diagnostic : { check: result.diagnostic, observer: reported.error });
          const observerDiagnostic = reported.ok ? undefined :
            new VbdError("DIAGNOSTIC_SINK_FAILED", { operation: preflightName, cause: reported.error });
          result = evidenceResult(evidence, result.diagnostic,
            observerExecuted ? reported.ok ? "reported" : "failed" : undefined, observerDiagnostic);
          const afterObserver = run.halt();
          if (afterObserver) {
            // A late observer cannot turn an already known denial into a pass.
            if (result.status !== "fail") {
              const late = unknownResult(check, afterObserver, true, result);
              result = evidenceResult(late, late.diagnostic, result.observer, observerDiagnostic);
            }
          }
        }
        results[index] = result;
      }
    };
    await Promise.resolve();
    // Each worker is observed immediately; scope failures stop admission, not in-flight work.
    const workers = await Promise.all(Array.from({ length: Math.min(options.concurrency, checks.length) },
      () => observe(worker)));
    scope(workers);
    if (fatal) throw new VbdError("CONFIG_EXPIRED", {
      operation: preflightName, cause: { scope: fatal, workers }
    });
    if (workers.some(result => !result.ok)) throw new VbdError("OPERATION_FAILED", {
      operation: preflightName, cause: { workers }
    });
    const finalHalt = run.halt();
    const complete = Array.from({ length: checks.length }, (_, index) => {
      const result = results[index];
      if (result) {
        const check = checks[index];
        if (finalHalt && result.status !== "fail" && check) {
          const late = unknownResult(check, finalHalt, result.executed, result);
          return evidenceResult(late, late.diagnostic, result.observer, result.observerDiagnostic);
        }
        return result;
      }
      throw new VbdError("OPERATION_FAILED", { operation: preflightName, cause: { index, workers } });
    });
    const counts = {
      total: complete.length, executed: complete.filter(result => result.executed).length,
      pass: complete.filter(result => result.status === "pass").length,
      fail: complete.filter(result => result.status === "fail").length,
      unknown: complete.filter(result => result.status === "unknown").length,
      unsupported: complete.filter(result => result.status === "unsupported").length,
      observerFailed: complete.filter(result => result.observer === "failed").length
    };
    const status = complete.some(result => result.required && result.status === "fail") ? "blocked" :
      counts.pass === counts.total && counts.observerFailed === 0 ? "ready" : "incomplete";
    return Object.freeze({
      status, basis: "trusted-read-only-checks", correlationId: crypto.randomUUID(),
      checks: Object.freeze(complete), counts: Object.freeze(counts)
    });
  } catch (cause) {
    throw Diagnostics.normalizeError(cause, { operation: preflightName });
  } finally { release(); }
}
