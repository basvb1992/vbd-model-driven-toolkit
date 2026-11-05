import { z } from "zod";
import { copyRuntimeJson, runtimeSnapshot } from "./configuration-values.js";
import { formOf } from "./context.js";
import type { EntityRef } from "./entity-reference.js";
import { VbdError } from "./errors.js";
import { attributeOf } from "./forms.js";
import {
  callback, callbackFailure, checkedFailure, copyRefs, dependentFilter, lookupError, lookupRefs, lookupTables, lookupTarget, nativeVoid
} from "./lookup-common.js";
import { contextSchema } from "./platform.js";
import type { ReadContext } from "./platform.js";
import { registration } from "./registrations.js";
import type { Disposable } from "./registrations.js";
import { call, nameSchema, requireMethod, resultOf, sdkObject } from "./sdk.js";
import type { SdkObject } from "./sdk.js";
import { guidSchema, logicalNameSchema, parseInput } from "./validation.js";

export type DependentLookupState =
  | { status: "not-ready"; reason: "preparing" | "parent-empty" | "superseded" | "disposed"; selection: "cleared" | "retained-unvalidated" | "unknown" }
  | { status: "ready"; parent: EntityRef[]; selection: "cleared" | "retained-unvalidated" | "unknown" }
  | { status: "failed"; error: VbdError; scope: string; selection: "cleared" | "retained-unvalidated" | "unknown" };
export interface DependentLookupFailure {
  error: VbdError;
  scope: string;
}
export interface DependentLookupOptions {
  parentColumn: string;
  parentTables: readonly string[];
  childControl: string;
  entityType: string;
  lookupKind: "standard";
  ownerLookup: false;
  selectionOnInvalidate: "clear" | "retain-invalid";
  emptyParent: "not-ready";
  prepare(parent: readonly EntityRef[]): string | PromiseLike<string>;
  /** Synchronous sink. Readiness also retains failures if the sink itself fails. */
  onError(failure: DependentLookupFailure): void;
  context?: ReadContext;
}
export interface DependentLookupBinding extends Disposable {
  readonly state: DependentLookupState;
  /** Always settles to an observable state, never a hidden rejected promise. */
  readonly readiness: Promise<DependentLookupState>;
  refresh(): Promise<DependentLookupState>;
}
const optionsSchema = z.object({
  parentColumn: logicalNameSchema, parentTables: lookupTables, childControl: nameSchema,
  entityType: logicalNameSchema.transform(value => value.toLowerCase()),
  lookupKind: z.literal("standard"), ownerLookup: z.literal(false),
  selectionOnInvalidate: z.enum(["clear", "retain-invalid"]), emptyParent: z.literal("not-ready"),
  prepare: callback<DependentLookupOptions["prepare"]>(), onError: callback<DependentLookupOptions["onError"]>(),
  context: contextSchema.optional()
}).strict();
type Options = z.output<typeof optionsSchema>;
interface BindingEntry {
  parent: SdkObject;
  child: SdkObject;
  control: SdkObject;
  options: Options;
  binding: DependentLookupBinding;
  check(): void;
}
const bindings = new WeakMap<SdkObject, Set<BindingEntry>>();
let pendingPreparations = 0;

function sameContract(left: Options, right: Options): boolean {
  return left.parentColumn === right.parentColumn && left.childControl === right.childControl &&
    left.entityType === right.entityType && left.selectionOnInvalidate === right.selectionOnInvalidate &&
    left.prepare === right.prepare && left.onError === right.onError && left.context === right.context &&
    left.parentTables.length === right.parentTables.length && left.parentTables.every((table, i) => table === right.parentTables[i]);
}
function parentValue(parent: SdkObject, tables: string[]): EntityRef[] {
  const raw = call(parent, "getValue");
  const refs = resultOf(lookupRefs, copyRuntimeJson(raw === null ? [] : raw));
  if (refs.length > 1 || refs.some(ref => !tables.includes(ref.entityType))) {
    throw lookupError("FIELD_TYPE_MISMATCH", "lookups.bindDependent.parent");
  }
  return refs;
}
function parentKey(refs: readonly EntityRef[]): string {
  return JSON.stringify(refs);
}
function recordKey(form: SdkObject): string {
  const entity = sdkObject(sdkObject(form.data).entity);
  const id = resultOf(z.string(), call(entity, "getId"));
  const currentForm = call(sdkObject(form.ui).formSelector, "getCurrentItem");
  const formId = currentForm === null ? null : resultOf(guidSchema, call(currentForm, "getId"));
  return JSON.stringify([
    resultOf(logicalNameSchema, call(entity, "getEntityName")),
    id === "" || id === "{}" ? "" : resultOf(guidSchema, id),
    formId
  ]);
}
function cloneState(state: DependentLookupState): DependentLookupState {
  return state.status === "ready" ? { ...state, parent: copyRefs(state.parent) } : { ...state };
}
export function bindDependent(input: unknown, settings: DependentLookupOptions): DependentLookupBinding {
  const options = parseInput(optionsSchema, settings, "lookups.bindDependent");
  const form = formOf(input), target = lookupTarget(form, options.childControl, options.entityType);
  const parent = attributeOf(form, options.parentColumn);
  if (parent === target.attribute) throw lookupError("EVENT_REENTRY", "lookups.bindDependent");
  if (call(parent, "getAttributeType") !== "lookup" || call(parent, "getIsPartyList") !== false ||
      call(parent, "getName") !== options.parentColumn) {
    throw lookupError("UNSUPPORTED_SURFACE", "lookups.bindDependent.parent");
  }
  parentValue(parent, options.parentTables);
  const data = sdkObject(form.data), entity = sdkObject(data.entity), ui = sdkObject(form.ui);
  const identity = recordKey(form), snapshot = runtimeSnapshot(options.context);
  let entries = bindings.get(form);
  if (!entries) { entries = new Set(); bindings.set(form, entries); }
  for (const entry of entries) {
    if (entry.control === target.control || entry.child === target.attribute) {
      if (entry.parent === parent && entry.control === target.control && sameContract(entry.options, options)) {
        entry.check();
        return entry.binding;
      }
      throw lookupError("RESOURCE_CONFLICT", "lookups.bindDependent");
    }
  }
  if (entries.size >= 100) throw lookupError("LIMIT_EXCEEDED", "lookups.bindDependent");
  // Each owned edge is parent -> child. Reject any path child -> ... -> parent.
  const reachable = new Set<SdkObject>([target.attribute]);
  for (let changed = true; changed;) {
    changed = false;
    for (const entry of entries) {
      if (reachable.has(entry.parent) && !reachable.has(entry.child)) {
        reachable.add(entry.child); changed = true;
      }
    }
  }
  if (reachable.has(parent)) throw lookupError("EVENT_REENTRY", "lookups.bindDependent");

  const addSearch = requireMethod(target.control, "addPreSearch");
  const removeSearch = requireMethod(target.control, "removePreSearch");
  const addChange = requireMethod(parent, "addOnChange"), removeChange = requireMethod(parent, "removeOnChange");
  const addLoad = requireMethod(data, "addOnLoad"), removeLoad = requireMethod(data, "removeOnLoad");
  const addFilter = requireMethod(target.control, "addCustomFilter");
  const clear = options.selectionOnInvalidate === "clear" ? requireMethod(target.attribute, "setValue") : undefined;
  requireMethod(target.attribute, "getValue");
  let disposed = false, epoch = 0, pending = 0, entering = false, reporting = false, calling = false, searching = false;
  let filter: string | undefined, preparedParent = "";
  let selection: DependentLookupState["selection"] = "retained-unvalidated";
  let state: DependentLookupState = { status: "not-ready", reason: "preparing", selection };
  let readiness: Promise<DependentLookupState> = Promise.resolve(cloneState(state));
  const checkIdentity = () => {
    snapshot.check();
    if (disposed || formOf(input) !== form || form.data !== data || data.entity !== entity || form.ui !== ui ||
        recordKey(form) !== identity || attributeOf(form, options.parentColumn) !== parent) {
      throw lookupError("CONFIG_EXPIRED", "lookups.bindDependent.identity");
    }
    const now = lookupTarget(form, options.childControl, options.entityType);
    if (now.control !== target.control || now.attribute !== target.attribute) {
      throw lookupError("CONFIG_EXPIRED", "lookups.bindDependent.identity");
    }
  };
  const eventIdentity = (event: unknown, source?: SdkObject) => {
    if (call(event, "getFormContext") !== form || (source && call(event, "getEventSource") !== source)) {
      throw lookupError("CONFIG_EXPIRED", "lookups.bindDependent.event");
    }
    checkIdentity();
  };
  const reportFailure = (error: unknown): VbdError => {
    const original = callbackFailure(error, "lookups.bindDependent");
    let reported = original;
    const reportEpoch = epoch;
    // Sink failures remain visible with the exact original diagnostic retained.
    try {
      if (reporting) throw lookupError("EVENT_REENTRY", "lookups.bindDependent.onError");
      reporting = true;
      nativeVoid(options.onError({ error: original, scope: snapshot.scope }));
      if (epoch !== reportEpoch) throw lookupError("EVENT_REENTRY", "lookups.bindDependent.onError");
    } catch (sink) {
      reported = lookupError("ERROR_PRESENTATION_FAILED", "lookups.bindDependent.onError", { error: original, sink });
    } finally { reporting = false; }
    return reported;
  };
  const publishFailure = (error: unknown): DependentLookupState => {
    filter = undefined;
    state = { status: "failed", error: reportFailure(error), scope: snapshot.scope, selection };
    return cloneState(state);
  };
  const superseded = (): DependentLookupState => ({
    status: "not-ready", reason: disposed ? "disposed" : "superseded", selection
  });
  const begin = (): Promise<DependentLookupState> => {
    if (entering || calling || reporting) {
      epoch++;
      const failed = publishFailure(lookupError("EVENT_REENTRY", "lookups.bindDependent"));
      return Promise.resolve(failed);
    }
    entering = true;
    const current = ++epoch;
    filter = undefined;
    try {
      checkIdentity();
      const refs = parentValue(parent, options.parentTables), key = parentKey(refs);
      if (clear) {
        selection = "unknown";
        if (call(target.attribute, "getValue") !== null) nativeVoid(clear(null));
        if (call(target.attribute, "getValue") !== null) {
          throw lookupError("MUTATION_OUTCOME_UNKNOWN", "lookups.bindDependent.clear");
        }
        selection = "cleared";
      } else selection = "retained-unvalidated";
      checkIdentity();
      state = { status: "not-ready", reason: refs.length ? "preparing" : "parent-empty", selection };
      if (refs.length === 0) return Promise.resolve(cloneState(state));
      if (pending >= 8 || pendingPreparations >= 64) throw lookupError("LIMIT_EXCEEDED", "lookups.bindDependent");
      pending++; pendingPreparations++;
      const checkRun = () => {
        checkIdentity();
        if (epoch !== current || parentKey(parentValue(parent, options.parentTables)) !== key) {
          throw lookupError("CONFIG_EXPIRED", "lookups.bindDependent.parent");
        }
      };
      // Queue before calling trusted code, never return this promise as a native handler.
      return Promise.resolve().then(async () => {
        checkRun();
        let raw: unknown;
        try {
          let prepared: string | PromiseLike<string>;
          calling = true;
          try { prepared = options.prepare(copyRefs(refs)); }
          finally { calling = false; }
          raw = await prepared;
        }
        catch (error) {
          checkedFailure(checkRun, { error });
          throw callbackFailure(error, "lookups.bindDependent.prepare");
        }
        checkedFailure(checkRun);
        const prepared = dependentFilter(resultOf(z.string(), raw));
        checkRun();
        filter = prepared; preparedParent = key;
        state = { status: "ready", parent: copyRefs(refs), selection };
        return cloneState(state);
      }).catch((error: unknown) => {
        // Old tasks never overwrite a newer readiness state. Their own receipt retains errors.
        if (epoch !== current || disposed) {
          return {
            status: "failed" as const, error: reportFailure(error),
            scope: snapshot.scope, selection
          };
        }
        return publishFailure(error);
      }).finally(() => { pending--; pendingPreparations--; });
    } catch (error) { return Promise.resolve(publishFailure(error)); }
    finally { entering = false; }
  };
  const change = (event: unknown): void => {
    try { eventIdentity(event, parent); readiness = begin(); }
    catch (error) { epoch++; readiness = Promise.resolve(publishFailure(error)); }
  };
  const load = (event: unknown): void => {
    try { eventIdentity(event); readiness = begin(); }
    catch (error) { epoch++; readiness = Promise.resolve(publishFailure(error)); }
  };
  const search = (event: unknown): void => {
    const nested = searching;
    try {
      if (searching) throw lookupError("EVENT_REENTRY", "lookups.bindDependent.preSearch");
      searching = true;
      eventIdentity(event, target.control);
      if (state.status === "failed") throw state.error;
      if (state.status !== "ready" || !filter) throw lookupError("CONFIG_NOT_READY", "lookups.bindDependent.preSearch");
      if (parentKey(parentValue(parent, options.parentTables)) !== preparedParent) {
        epoch++;
        throw lookupError("CONFIG_EXPIRED", "lookups.bindDependent.preSearch");
      }
      const current = epoch, prepared = filter;
      nativeVoid(addFilter(prepared, options.entityType));
      checkIdentity();
      if (epoch !== current || filter !== prepared) throw lookupError("EVENT_REENTRY", "lookups.bindDependent.preSearch");
    } catch (error) {
      const preparing = pending > 0 && error instanceof VbdError && error.code === "CONFIG_NOT_READY";
      if (!preparing) epoch++;
      const failure = publishFailure(error);
      if (!preparing) readiness = Promise.resolve(failure);
      throw failure.status === "failed" ? failure.error : error;
    } finally { if (!nested) searching = false; }
  };
  // Cleanup attempts every owned remover, including an add that mutated then threw.
  const removers: (() => void)[] = [];
  const cleanup = () => {
    disposed = true; epoch++; filter = undefined;
    state = superseded();
    readiness = Promise.resolve(cloneState(state));
    const failures: unknown[] = [];
    for (let index = removers.length - 1; index >= 0; index--) {
      try { removers[index]?.(); removers.splice(index, 1); }
      catch (error) { failures.push(error); }
    }
    if (failures.length) throw lookupError("PARTIAL_FAILURE", "lookups.bindDependent.dispose", failures);
    entries.delete(entry);
  };
  const owned = registration("dependent-lookup", cleanup);
  const binding: DependentLookupBinding = Object.freeze({
    id: owned.id,
    get state() {
      if (!disposed) {
        try {
          checkIdentity();
          if (state.status === "ready" && parentKey(parentValue(parent, options.parentTables)) !== preparedParent) {
            throw lookupError("CONFIG_EXPIRED", "lookups.bindDependent.parent");
          }
        }
        catch (error) {
          if (state.status !== "failed") { epoch++; readiness = Promise.resolve(publishFailure(error)); }
        }
      }
      return cloneState(state);
    },
    get readiness() { return readiness; },
    refresh(this: unknown) {
      if (this !== binding) throw lookupError("INVALID_ARGUMENT", "lookups.bindDependent.refresh");
      if (disposed) return Promise.resolve(superseded());
      readiness = begin();
      return readiness;
    },
    dispose(this: unknown) {
      if (this !== binding) throw lookupError("INVALID_ARGUMENT", "lookups.bindDependent.dispose");
      return owned.dispose();
    }
  });
  const entry: BindingEntry = { parent, child: target.attribute, control: target.control, options, binding, check: checkIdentity };
  entries.add(entry);
  try {
    removers.push(() => { nativeVoid(removeSearch(search)); }); nativeVoid(addSearch(search));
    removers.push(() => { nativeVoid(removeChange(change)); }); nativeVoid(addChange(change));
    removers.push(() => { nativeVoid(removeLoad(load)); }); nativeVoid(addLoad(load));
  } catch (error) {
    try { owned.dispose(); }
    catch (cleanupError) {
      throw lookupError("PARTIAL_FAILURE", "lookups.bindDependent.register", { error, cleanup: cleanupError, binding });
    }
    throw error;
  }
  readiness = begin();
  return binding;
}
