import { z } from "zod";
import { copyRuntimeJson, runtimePredicate, runtimeSnapshot } from "./configuration-values.js";
import { entityRefSchema } from "./entity-reference.js";
import type { EntityRef } from "./entity-reference.js";
import {
  callback, callbackFailure, checkedFailure, copyRefs, lookupError, lookupRefs, lookupTables, rejectAsyncEvidence
} from "./lookup-common.js";
import { contextSchema } from "./platform.js";
import type { ReadContext } from "./platform.js";
import { resultOf } from "./sdk.js";
import { parseInput } from "./validation.js";

export interface LookupAccessEvidence {
  ref: EntityRef;
  status: "granted" | "denied" | "unknown";
  basis: "caller-evidence";
}
type Predicate =
  | { mode: "sync"; test(ref: EntityRef): boolean }
  | { mode: "async"; test(ref: EntityRef): boolean | PromiseLike<boolean> };
type Access =
  | { policy: "not-checked" }
  | { policy: "required"; mode: "sync"; check(ref: EntityRef): LookupAccessEvidence }
  | { policy: "required"; mode: "async"; check(ref: EntityRef): LookupAccessEvidence | PromiseLike<LookupAccessEvidence> };
export interface LookupSelectionOptions {
  allowedTables: readonly string[];
  cardinality: { min: number; max: number };
  empty: "valid" | "invalid";
  predicate: Predicate;
  access: Access;
  context?: ReadContext;
  concurrency?: number;
}
export interface LookupSelectionItem {
  ref: EntityRef;
  predicate: "passed" | "failed" | "not-run";
  access: "granted" | "unknown" | "not-checked";
}
export interface LookupSelectionResult {
  status: "valid" | "invalid" | "unknown";
  reason: "validated" | "empty" | "cardinality" | "target" | "predicate" | "access-unknown";
  basis: "trusted-caller-checks";
  records: LookupSelectionItem[];
}
const predicateSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("sync"), test: callback<(ref: EntityRef) => boolean>() }).strict(),
  z.object({
    mode: z.literal("async"), test: callback<(ref: EntityRef) => boolean | PromiseLike<boolean>>()
  }).strict()
]);
const accessSchema = z.union([
  z.object({ policy: z.literal("not-checked") }).strict(),
  z.object({
    policy: z.literal("required"), mode: z.enum(["sync", "async"]),
    check: callback<(ref: EntityRef) => LookupAccessEvidence | PromiseLike<LookupAccessEvidence>>()
  }).strict()
]);
const optionsSchema = z.object({
  allowedTables: lookupTables,
  cardinality: z.object({ min: z.number().int().min(0).max(100), max: z.number().int().min(1).max(100) }).strict()
    .refine(value => value.min <= value.max),
  empty: z.enum(["valid", "invalid"]), predicate: predicateSchema, access: accessSchema,
  context: contextSchema.optional(), concurrency: z.number().int().min(1).max(8).default(4)
}).strict();
const evidenceSchema = z.object({
  ref: entityRefSchema, status: z.enum(["granted", "denied", "unknown"]), basis: z.literal("caller-evidence")
}).strict();
let activeRuns = 0;

export async function validateSelection(
  input: readonly EntityRef[], settings: LookupSelectionOptions
): Promise<LookupSelectionResult> {
  const refs = parseInput(lookupRefs, copyRuntimeJson(input), "lookups.validateSelection");
  const options = parseInput(optionsSchema, settings, "lookups.validateSelection");
  const snapshot = runtimeSnapshot(options.context);
  const check = () => snapshot.check();
  check();
  const records: LookupSelectionItem[] = copyRefs(refs).map(ref => ({ ref, predicate: "not-run", access: "not-checked" }));
  const report = (status: LookupSelectionResult["status"], reason: LookupSelectionResult["reason"]): LookupSelectionResult => {
    check();
    return { status, reason, basis: "trusted-caller-checks", records: records.map(item => ({ ...item, ref: { ...item.ref } })) };
  };
  if (refs.length < options.cardinality.min || refs.length > options.cardinality.max) return report("invalid", "cardinality");
  if (refs.some(ref => !options.allowedTables.includes(ref.entityType))) return report("invalid", "target");
  if (refs.length === 0) return report(options.empty, "empty");
  if (activeRuns >= 8) throw lookupError("LIMIT_EXCEEDED", "lookups.validateSelection");
  activeRuns++;
  let next = 0, failure: { error: unknown } | undefined;
  async function inspect(index: number, ref: EntityRef): Promise<void> {
    check();
    let accepted: unknown;
    try {
      if (options.predicate.mode === "sync") {
        const test = options.predicate.test;
        // The shared synchronous guard observes/rejects illegally returned thenables.
        runtimePredicate(() => {
          const value = test({ ...ref });
          accepted = value;
          return value === false ? true : value;
        }, undefined);
      } else {
        accepted = await options.predicate.test({ ...ref });
      }
    } catch (error) {
      checkedFailure(check, { error });
      throw callbackFailure(error, "lookups.validateSelection.predicate");
    }
    checkedFailure(check);
    const passed = resultOf(z.boolean(), accepted);
    const item = records[index];
    if (!item) throw lookupError("DATA_RESPONSE_INVALID", "lookups.validateSelection");
    item.predicate = passed ? "passed" : "failed";
    if (options.access.policy === "required") {
      let raw: unknown;
      try {
        check();
        if (options.access.mode === "sync") {
          // A sync evidence callback cannot leak an unobserved rejecting promise.
          raw = options.access.check({ ...ref });
          rejectAsyncEvidence(raw);
        } else {
          raw = await options.access.check({ ...ref });
        }
      } catch (error) {
        checkedFailure(check, { error });
        throw callbackFailure(error, "lookups.validateSelection.access");
      }
      checkedFailure(check);
      const evidence = resultOf(evidenceSchema, copyRuntimeJson(raw));
      if (evidence.ref.id !== ref.id || evidence.ref.entityType !== ref.entityType) {
        throw lookupError("DATA_RESPONSE_INVALID", "lookups.validateSelection.evidence");
      }
      if (evidence.status === "denied") throw lookupError("ACCESS_DENIED", "lookups.validateSelection.access", evidence);
      item.access = evidence.status;
    }
    check();
  }
  async function worker(): Promise<void> {
    while (!failure && next < refs.length) {
      const index = next++, ref = refs[index];
      if (!ref) return;
      try { await inspect(index, ref); }
      catch (error) { failure ??= { error }; }
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(options.concurrency, refs.length) }, worker));
    checkedFailure(check, failure);
    if (failure) throw failure.error;
    if (records.some(item => item.access === "unknown")) return report("unknown", "access-unknown");
    if (records.some(item => item.predicate === "failed")) return report("invalid", "predicate");
    return report("valid", "validated");
  } finally { activeRuns--; }
}
