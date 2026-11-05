import { z } from "zod";
import { copyRuntimeJson } from "./configuration-values.js";
import { plain, safeKey } from "./data-core.js";
import { messageForCode, VbdError } from "./errors.js";
import type { ErrorCode } from "./errors.js";
import type { EntityRef } from "./entity-reference.js";
import type { MetadataRelationship } from "./metadata.js";
import { readScope, scopeKey } from "./platform.js";
import type { ReadContext, ReadScope } from "./platform.js";
import { call, globalContext, sdkObject, sdkRoot } from "./sdk.js";
import { guidSchema, isRecord, logicalNameSchema, parseInput } from "./validation.js";

const operation = "relationships.mutate";
const identifier = logicalNameSchema.refine(safeKey);
const logical = identifier.refine(value => value === value.toLowerCase());
const reference = z.object({
  entityType: identifier.transform(value => value.toLowerCase()),
  id: guidSchema.refine(value => value !== "00000000-0000-0000-0000-000000000000"),
  name: z.string().max(8192).optional()
}).strict().transform(({ entityType, id }) => ({ entityType, id }));
const references = z.array(reference).min(1).max(100)
  .refine(refs => new Set(refs.map(ref => `${ref.entityType}:${ref.id}`)).size === refs.length);
const scopeSchema = z.object({
  environmentUrl: z.string(), userId: guidSchema,
  languageId: z.number().int().min(1).max(65535), online: z.literal(true)
}).strict();
const currentScopeSchema = scopeSchema.extend({ online: z.boolean() });
const metadataSchema = z.object({
  kind: z.literal("manyToMany"), SchemaName: identifier,
  Entity1LogicalName: logical, Entity2LogicalName: logical,
  Entity1NavigationPropertyName: identifier, Entity2NavigationPropertyName: identifier,
  IntersectEntityName: logical, Entity1IntersectAttribute: logical, Entity2IntersectAttribute: logical
}).strict();

/** Explicit, current-scope metadata. No label, pluralization, lookup or record discovery. */
export interface RelationshipContract {
  scope: Readonly<ReadScope>;
  metadata: Extract<MetadataRelationship, { kind: "manyToMany" }>;
  sourceSide: "entity1" | "entity2";
  navigationProperty: string;
  cardinality: "collection";
}
const contractSchema = z.object({
  scope: scopeSchema, metadata: metadataSchema,
  sourceSide: z.enum(["entity1", "entity2"]),
  navigationProperty: identifier, cardinality: z.literal("collection")
}).strict().refine(value => value.navigationProperty === (value.sourceSide === "entity1"
  ? value.metadata.Entity1NavigationPropertyName : value.metadata.Entity2NavigationPropertyName));
const selectionSchema = z.object({
  source: reference, relationship: contractSchema, targets: references
}).strict();

export interface RelationshipRequestMetadata {
  boundParameter: null;
  parameterTypes: Record<string, never>;
  operationType: 2;
  operationName: "Associate" | "Disassociate";
}
/** Only the documented many-to-many CRUD request shapes; never an arbitrary execute request. */
export type RelationshipRequest =
  | { readonly target: Readonly<EntityRef>; readonly relatedEntities: readonly Readonly<EntityRef>[];
      readonly relationship: string; getMetadata(): RelationshipRequestMetadata }
  | { readonly target: Readonly<EntityRef>; readonly relatedEntityId: string;
      readonly relationship: string; getMetadata(): RelationshipRequestMetadata };
export interface RelationshipContext {
  getScope(): Readonly<ReadScope>;
  /**
   * Trusted adapter: one relation per request, in this exact current-user/online scope.
   * Return {ok:boolean,status:number}; only 204 confirms completion. Reject HTTP failures
   * with an integer status; failures without authoritative status remain uncertain.
   * This declaration is NOT proof of server authorization, atomicity or adapter purity.
   */
  executeRelationship?(request: RelationshipRequest, scope: Readonly<ReadScope>,
    contract: Readonly<RelationshipContract>): Promise<unknown>;
}
export interface RelationshipOptions { context?: RelationshipContext }
export interface RelationshipConfirmation {
  policy: "confirm-disassociate";
  source: EntityRef;
  relationship: RelationshipContract;
  /** Exact normalized identities, in the same order as the requested targets. */
  targets: readonly EntityRef[];
}
export interface DisassociateOptions extends RelationshipOptions {
  confirmation: RelationshipConfirmation;
}
export interface RelationshipDiagnostic {
  code: ErrorCode;
  message: string;
  operation: string;
  correlationId: string;
}
export type RelationshipItem =
  | { target: EntityRef; status: "completed"; attempted: true; responseStatus: 204 }
  | { target: EntityRef; status: "failed" | "uncertain"; attempted: true;
      error: Readonly<RelationshipDiagnostic>; readonly diagnostic?: VbdError }
  | { target: EntityRef; status: "skipped"; attempted: false; reason: "previousFailure" | "scopeChanged" };
export interface RelationshipResult {
  operation: "associate" | "disassociate";
  source: EntityRef;
  relationship: string;
  navigationProperty: string;
  /** No multi-target atomicity or rollback is claimed. Dispatch stops at the first failure. */
  status: "completed" | "partial" | "failed" | "uncertain";
  items: RelationshipItem[];
  counts: { requested: number; attempted: number; completed: number; failed: number;
    uncertain: number; skipped: number };
  /** Present on any stopped operation; raw evidence is non-enumerable in diagnostic/cause. */
  error?: Readonly<RelationshipDiagnostic>;
  readonly diagnostic?: VbdError;
}
const contextSchema = z.custom<RelationshipContext>(value => isRecord(value) &&
  typeof value.getScope === "function" &&
  (value.executeRelationship === undefined || typeof value.executeRelationship === "function"));
const optionsSchema = z.object({ context: contextSchema.optional() }).strict();
const removalOptionsSchema = optionsSchema.extend({
  confirmation: z.object({
    policy: z.literal("confirm-disassociate"),
    source: reference, relationship: contractSchema, targets: references
  }).strict()
});

function fail(code: ErrorCode, cause?: unknown): never {
  throw new VbdError(code, { operation, ...(cause === undefined ? {} : { cause }) });
}
function scopeOf(context: Pick<RelationshipContext, "getScope">): ReadScope {
  const bridge: ReadContext = {
    getScope: () => context.getScope(),
    retrieveMultipleRecords: () => fail("UNSUPPORTED_SURFACE")
  };
  return readScope(bridge);
}
function nativeContext(): RelationshipContext {
  const online = sdkRoot(["WebApi", "online"]);
  const execute = online.execute;
  if (typeof execute !== "function") fail("UNSUPPORTED_SURFACE");
  return {
    getScope: () => {
      const current = globalContext(), user = sdkObject(current.userSettings);
      return parseInput(currentScopeSchema, {
        environmentUrl: call(current, "getClientUrl"),
        userId: user.userId, languageId: user.languageId,
        online: call(current.client, "getClientState") === "Online"
      }, operation);
    },
    executeRelationship: request => {
      const result: unknown = Reflect.apply(execute, online, [request]);
      return Promise.resolve(result);
    }
  };
}
// Microsoft Learn attaches getMetadata to the prototype, not to the function object.
class AssociateRequest {
  readonly target;
  readonly relatedEntities;
  constructor(source: EntityRef, target: EntityRef, readonly relationship: string) {
    this.target = Object.freeze({ ...source });
    this.relatedEntities = Object.freeze([Object.freeze({ ...target })]);
    Object.freeze(this);
  }
  getMetadata(): RelationshipRequestMetadata {
    return { boundParameter: null, parameterTypes: {}, operationType: 2, operationName: "Associate" };
  }
}
class DisassociateRequest {
  readonly target;
  readonly relatedEntityId;
  constructor(source: EntityRef, target: EntityRef, readonly relationship: string) {
    this.target = Object.freeze({ ...source });
    this.relatedEntityId = target.id;
    Object.freeze(this);
  }
  getMetadata(): RelationshipRequestMetadata {
    return { boundParameter: null, parameterTypes: {}, operationType: 2, operationName: "Disassociate" };
  }
}
Object.freeze(AssociateRequest.prototype);
Object.freeze(DisassociateRequest.prototype);
function diagnostic(error: VbdError): Readonly<RelationshipDiagnostic> {
  return Object.freeze({
    code: error.code, message: messageForCode(error.code), operation,
    correlationId: error.correlationId
  });
}
function retain<T extends object>(value: T, error: VbdError): T {
  Object.defineProperty(value, "diagnostic", { value: error, enumerable: false });
  return value;
}
// Read data descriptors only on rejection; never run arbitrary customer error getters.
function errorField(cause: unknown, key: string): unknown {
  if (!isRecord(cause)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(cause, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}
function statusCode(status: unknown, errorCode?: unknown): ErrorCode {
  if (status === 401 || status === 403 ||
      typeof errorCode === "number" && (errorCode >>> 0) === 0x80040220) return "ACCESS_DENIED";
  if (status === 404) return "RESOURCE_NOT_FOUND";
  if (status === 412) return "CONCURRENCY_CONFLICT";
  if (typeof status === "number" && Number.isInteger(status) &&
      status >= 400 && status < 500 && status !== 408) return "DATA_WRITE_FAILED";
  return "MUTATION_OUTCOME_UNKNOWN";
}
function transportError(cause: unknown): VbdError {
  try {
    return new VbdError(statusCode(errorField(cause, "status"), errorField(cause, "errorCode")),
      { operation, cause });
  } catch (classificationCause) {
    return new VbdError("MUTATION_OUTCOME_UNKNOWN", { operation, cause: { cause, classificationCause } });
  }
}
function responseError(value: unknown): VbdError | undefined {
  // Native responses may expose inherited accessors. Scope is checked again after this guard.
  const invalid = () => new VbdError("MUTATION_OUTCOME_UNKNOWN", { operation, cause: value });
  if (!isRecord(value) || Array.isArray(value)) return invalid();
  const ok = value.ok, status = value.status;
  if (typeof ok !== "boolean" || typeof status !== "number" || !Number.isInteger(status) ||
      status < 100 || status > 599 || ok !== (status >= 200 && status < 300)) {
    return invalid();
  }
  if (ok && status === 204) return;
  return new VbdError(ok ? "MUTATION_OUTCOME_UNKNOWN" : statusCode(status), { operation, cause: value });
}
function matches(source: EntityRef, targets: readonly EntityRef[], contract: RelationshipContract): boolean {
  const first = contract.sourceSide === "entity1", metadata = contract.metadata;
  return source.entityType === (first ? metadata.Entity1LogicalName : metadata.Entity2LogicalName) &&
    targets.every(target => target.entityType === (first ? metadata.Entity2LogicalName : metadata.Entity1LogicalName));
}
async function mutate(kind: "associate" | "disassociate", source: EntityRef,
  relationship: RelationshipContract, targets: readonly EntityRef[],
  settings: RelationshipOptions | DisassociateOptions): Promise<RelationshipResult> {
  // Isolate all identities/metadata before any scope callback, await or dispatch.
  const selection = parseInput(selectionSchema,
    copyRuntimeJson({ source, relationship, targets }), operation);
  if (!plain(settings)) fail("INVALID_ARGUMENT");
  let options: z.output<typeof optionsSchema>;
  if (kind === "disassociate") {
    const removal = parseInput(removalOptionsSchema, {
      ...settings,
      confirmation: copyRuntimeJson("confirmation" in settings ? settings.confirmation : null)
    }, operation);
    const confirmation = {
      source: removal.confirmation.source, relationship: removal.confirmation.relationship,
      targets: removal.confirmation.targets
    };
    if (JSON.stringify(confirmation) !== JSON.stringify(selection)) fail("INVALID_ARGUMENT");
    options = removal;
  } else options = parseInput(optionsSchema, settings, operation);
  if (!matches(selection.source, selection.targets, selection.relationship)) fail("INVALID_ARGUMENT");
  // The documented native example uses the same relationship/navigation name.
  // Do not invent a native alias/direction mapping when those names differ.
  if (options.context === undefined &&
      selection.relationship.metadata.SchemaName !== selection.relationship.navigationProperty) {
    fail("UNSUPPORTED_SURFACE");
  }
  const context = options.context ?? nativeContext();
  // Capture trusted capabilities/receivers once, before the final preflight scope check.
  const getScope = context.getScope, execute = context.executeRelationship;
  if (typeof execute !== "function") fail("UNSUPPORTED_SURFACE");
  const scoped = { getScope: () => getScope.call(context) };
  const expectedScope = Object.freeze(scopeOf(scoped)), key = scopeKey(expectedScope);
  if (scopeKey(scopeOf({ getScope: () => selection.relationship.scope })) !== key) fail("CONFIG_EXPIRED");
  const adapterContract: Readonly<RelationshipContract> = Object.freeze({
    ...selection.relationship, scope: Object.freeze({ ...expectedScope }),
    metadata: Object.freeze({ ...selection.relationship.metadata })
  });
  const check = () => {
    try { if (scopeKey(scopeOf(scoped)) !== key) fail("CONFIG_EXPIRED"); }
    catch (cause) { fail("CONFIG_EXPIRED", cause); }
  };
  const requests = selection.targets.map(target => kind === "associate"
    ? new AssociateRequest(selection.source, target, selection.relationship.metadata.SchemaName)
    : new DisassociateRequest(selection.source, target, selection.relationship.metadata.SchemaName));
  check(); // All targets, contracts, confirmation and capabilities preflight before dispatch.
  const items: RelationshipItem[] = [];
  let stopped: VbdError | undefined;
  for (const [index, target] of selection.targets.entries()) {
    if (stopped) {
      items.push({ target: { ...target }, status: "skipped", attempted: false, reason: "previousFailure" });
      continue;
    }
    try { check(); }
    catch (cause) {
      stopped = new VbdError("CONFIG_EXPIRED", { operation, cause });
      items.push({ target: { ...target }, status: "skipped", attempted: false, reason: "scopeChanged" });
      continue;
    }
    const request = requests[index];
    if (!request) fail("INVALID_ARGUMENT"); // Dense, bounded canonical arrays were constructed above.
    let response: unknown, error: VbdError | undefined;
    try { response = await execute.call(context, request, expectedScope, adapterContract); }
    catch (cause) { error = transportError(cause); }
    try {
      check();
      if (!error) error = responseError(response);
      check();
    } catch (cause) {
      error = new VbdError("MUTATION_OUTCOME_UNKNOWN", { operation, cause: { cause, response, error } });
      // Validation itself (including a native getter) can change scope, even when it throws.
      try { check(); }
      catch (scopeCause) {
        error = new VbdError("MUTATION_OUTCOME_UNKNOWN", { operation, cause: { scopeCause, response, error } });
      }
    }
    if (error) {
      stopped = error;
      items.push(retain({
        target: { ...target }, status: error.code === "MUTATION_OUTCOME_UNKNOWN" ? "uncertain" : "failed",
        attempted: true, error: diagnostic(error)
      } satisfies RelationshipItem, error));
    } else {
      items.push({ target: { ...target }, status: "completed", attempted: true, responseStatus: 204 });
    }
  }
  const counts = {
    requested: items.length, attempted: items.filter(item => item.attempted).length,
    completed: items.filter(item => item.status === "completed").length,
    failed: items.filter(item => item.status === "failed").length,
    uncertain: items.filter(item => item.status === "uncertain").length,
    skipped: items.filter(item => item.status === "skipped").length
  };
  const result: RelationshipResult = {
    operation: kind, source: { ...selection.source },
    relationship: selection.relationship.metadata.SchemaName,
    navigationProperty: selection.relationship.navigationProperty,
    status: !stopped ? "completed" : counts.completed > 0 ? "partial"
      : counts.uncertain > 0 ? "uncertain" : "failed",
    items, counts, ...(stopped ? { error: diagnostic(stopped) } : {})
  };
  return stopped ? retain(result, stopped) : result;
}
function associate(source: EntityRef, relationship: RelationshipContract, targets: readonly EntityRef[],
  options: RelationshipOptions = {}): Promise<RelationshipResult> {
  return mutate("associate", source, relationship, targets, options);
}
function disassociate(source: EntityRef, relationship: RelationshipContract, targets: readonly EntityRef[],
  options: DisassociateOptions): Promise<RelationshipResult> {
  return mutate("disassociate", source, relationship, targets, options);
}
export const Relationships = Object.freeze({ associate, disassociate });
