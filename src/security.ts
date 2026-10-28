import { z } from "zod";
import { jsonValue, plain, safeKey } from "./data-core.js";
import { VbdError } from "./errors.js";
import { scopeKey } from "./platform.js";
import type { ReadScope } from "./platform.js";
import { call, callAsync, globalContext, sdkObject, sdkRoot } from "./sdk.js";
import { environmentRoot, guidSchema, isRecord, logicalNameSchema, parseInput } from "./validation.js";

export type PrivilegeDepth = "basic" | "local" | "deep" | "global";
export type SecurityDepthEncoding = "semantic" | "sdk-enum" | "privilege-mask" | "unverified";
export type TableOperation = "create" | "read" | "write" | "delete" | "assign" | "share" | "append" | "appendTo";
export type PrivilegeIdentity = { id: string; name?: never } | { name: string; id?: never };
export type SecurityScope = Readonly<ReadScope>;

/** Adapter attests completeness, encoding and the scope in which the read was made. */
export interface SecurityPrivilegeRead {
  readonly scope: SecurityScope;
  readonly complete: boolean;
  readonly depthEncoding: SecurityDepthEncoding;
  readonly privileges: unknown;
}
export interface SecurityTableRead {
  readonly scope: SecurityScope;
  readonly complete: boolean;
  readonly metadata: unknown;
}
/** Read-only capabilities only. No execute, role-name lookup, writes or tenant export. */
export interface SecurityContext {
  getScope(): SecurityScope;
  getSecurityRolePrivilegesInfo?(): Promise<SecurityPrivilegeRead>;
  getEntityMetadata?(table: string): Promise<SecurityTableRead>;
}
export interface SecurityOptions {
  requiredDepth?: PrivilegeDepth;
  context?: SecurityContext;
}
export type SecurityReason =
  | "depth-sufficient" | "privilege-absent" | "depth-insufficient"
  | "api-unavailable" | "read-denied" | "read-failed" | "scope-unavailable" | "scope-changed"
  | "incomplete-privileges" | "incomplete-table-metadata" | "invalid-response"
  | "ambiguous-privileges" | "unverified-depth" | "unsupported-depth" | "operation-unavailable";
export interface SecurityObservationScope {
  readonly basis: "current-user-table-privileges";
  readonly source: "xrm" | "adapter";
  readonly observation: "current" | "changed" | "unavailable";
  readonly environment: "redacted";
  readonly user: "redacted";
  readonly languageId?: number;
}
export interface AccessAssessment {
  readonly state: "allowed" | "denied" | "unknown";
  readonly reason: SecurityReason;
  readonly requiredDepth: PrivilegeDepth;
  readonly grantedDepth?: PrivilegeDepth;
  readonly scope: SecurityObservationScope;
  /** Non-enumerable; use Diagnostics.report, never serialize a raw cause. */
  readonly diagnostic?: VbdError;
}

const depths = ["basic", "local", "deep", "global"] as const;
const depthSchema = z.enum(depths);
const privilegeNameSchema = z.string().regex(/^prv[A-Za-z][A-Za-z0-9_]{0,251}$/);
const identitySchema = z.union([
  z.object({ id: guidSchema }).strict(),
  z.object({ name: privilegeNameSchema }).strict()
]);
const scopeSchema = z.object({
  environmentUrl: z.string(), userId: guidSchema,
  languageId: z.number().int().min(1).max(65535), online: z.literal(true)
}).strict();
const contextSchema = z.custom<SecurityContext>(value =>
  isRecord(value) && typeof value.getScope === "function" &&
  (value.getSecurityRolePrivilegesInfo === undefined || typeof value.getSecurityRolePrivilegesInfo === "function") &&
  (value.getEntityMetadata === undefined || typeof value.getEntityMetadata === "function")
);
const optionsSchema = z.object({
  requiredDepth: depthSchema.default("basic"), context: contextSchema.optional()
}).strict();
// Client API getEntityMetadata documents this exact enum, NOT access-right bit masks.
const operationTypes = { create: 1, read: 2, write: 3, delete: 4, assign: 5, share: 6, append: 7, appendTo: 8 } as const;
const operationSchema = z.enum(["create", "read", "write", "delete", "assign", "share", "append", "appendTo"]);
const entrySchema = z.object({
  id: guidSchema, businessUnitId: guidSchema, privilegeName: privilegeNameSchema,
  depth: z.union([z.number().int().nonnegative(), z.string().min(1).max(32)])
});
const tablePrivilegeSchema = z.object({
  PrivilegeId: guidSchema, Name: privilegeNameSchema, PrivilegeType: z.number().int().min(0).max(8),
  CanBeBasic: z.boolean(), CanBeLocal: z.boolean(), CanBeDeep: z.boolean(), CanBeGlobal: z.boolean(),
  CanBeEntityReference: z.boolean(), CanBeParentEntityReference: z.boolean()
});
const tableSchema = z.object({
  LogicalName: logicalNameSchema.transform(value => value.toLowerCase()),
  Privileges: z.array(tablePrivilegeSchema).max(32)
});
const privilegeReadSchema = z.object({
  scope: scopeSchema, complete: z.boolean(),
  depthEncoding: z.enum(["semantic", "sdk-enum", "privilege-mask", "unverified"]),
  privileges: z.unknown()
}).strict();
const tableReadSchema = z.object({
  scope: scopeSchema, complete: z.boolean(), metadata: z.unknown()
}).strict();
type Decision = Pick<AccessAssessment, "state" | "reason" | "grantedDepth">;
function unknown(reason: SecurityReason): Decision { return { state: "unknown", reason }; }
function response<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new VbdError("DATA_RESPONSE_INVALID", { operation: "security.response" });
  return parsed.data;
}
function normalizeScope(input: unknown): ReadScope {
  const scope = parseInput(scopeSchema, input, "security.scope");
  return { ...scope, environmentUrl: environmentRoot(scope.environmentUrl).origin };
}
function getScope(context: SecurityContext): ReadScope {
  return normalizeScope(call(context, "getScope"));
}
function nativeContext(): SecurityContext {
  const getCurrentScope = (): ReadScope => {
    const current = globalContext(), user = sdkObject(current.userSettings);
    return normalizeScope({
      environmentUrl: call(current, "getClientUrl"),
      userId: user.userId, languageId: user.languageId,
      online: call(current.client, "getClientState") === "Online"
    });
  };
  return {
    getScope: getCurrentScope,
    getSecurityRolePrivilegesInfo: async () => {
      const scope = getCurrentScope();
      const privileges = await callAsync(globalContext().userSettings, "getSecurityRolePrivilegesInfo");
      // Learn documents number AND string, but does not bind this API to either
      // SDK ordinal depths (0,1,2,3) or masks (1,2,4,8). Never guess.
      return { scope, complete: true, depthEncoding: "unverified", privileges };
    },
    getEntityMetadata: async table => {
      const scope = getCurrentScope();
      const metadata = await callAsync(sdkRoot(["Utility"]), "getEntityMetadata", table, []);
      return { scope, complete: true, metadata };
    }
  };
}
class Observation {
  constructor(readonly context: SecurityContext, readonly scope: ReadScope) {}
  check(): void {
    try {
      this.checkScope(getScope(this.context));
    } catch (cause) {
      throw new VbdError("CONFIG_EXPIRED", { operation: "security.scope", cause });
    }
  }
  checkScope(input: unknown): void {
    if (scopeKey(normalizeScope(input)) !== scopeKey(this.scope)) {
      throw new VbdError("CONFIG_EXPIRED", { operation: "security.scope" });
    }
  }
  async read(name: "getSecurityRolePrivilegesInfo" | "getEntityMetadata", ...args: string[]): Promise<unknown> {
    this.check();
    const value = await callAsync(this.context, name, ...args);
    this.check();
    return value;
  }
}
function classify(cause: unknown): VbdError {
  if (cause instanceof VbdError && cause.cause !== undefined &&
      cause.code === "SDK_OPERATION_FAILED") {
    const inner = classify(cause.cause);
    if (inner.code === "ACCESS_DENIED") return inner;
  }
  if (cause instanceof VbdError) return cause;
  const denied = isRecord(cause) && (cause.status === 401 || cause.status === 403 ||
    (typeof cause.errorCode === "number" && (cause.errorCode >>> 0) === 0x80040220));
  return new VbdError(denied ? "ACCESS_DENIED" : "DATA_READ_FAILED", {
    operation: "security.read", cause
  });
}
function failureReason(error: VbdError): SecurityReason {
  switch (error.code) {
    case "CONFIG_EXPIRED": return "scope-changed";
    case "ACCESS_DENIED": return "read-denied";
    case "UNSUPPORTED_SURFACE": return "api-unavailable";
    case "DATA_RESPONSE_INVALID": return "invalid-response";
    default: return "read-failed";
  }
}
function report(
  decision: Decision, requiredDepth: PrivilegeDepth, source: "xrm" | "adapter",
  scope: ReadScope | undefined, diagnostic?: VbdError
): AccessAssessment {
  const observation = decision.reason === "scope-changed" ? "changed" :
    decision.reason === "scope-unavailable" ? "unavailable" : "current";
  const result: AccessAssessment = {
    ...decision, requiredDepth,
    scope: Object.freeze({
      basis: "current-user-table-privileges", source, observation,
      environment: "redacted", user: "redacted",
      ...(scope === undefined ? {} : { languageId: scope.languageId })
    })
  };
  // Safe JSON uses only the bounded projection, not the retained error/cause.
  Object.defineProperty(result, "toJSON", { value: () => jsonValue(result) });
  if (diagnostic !== undefined) Object.defineProperty(result, "diagnostic", { value: diagnostic });
  return Object.freeze(result);
}
async function observe(
  options: SecurityOptions, assess: (observation: Observation, depth: PrivilegeDepth) => Promise<Decision>
): Promise<AccessAssessment> {
  const parsed = parseInput(optionsSchema, options, "security.options");
  const source = parsed.context === undefined ? "xrm" : "adapter";
  const context = parsed.context ?? nativeContext();
  let scope: ReadScope;
  try { scope = getScope(context); }
  catch (cause) {
    // Supplied invalid scopes are caller errors, never observations.
    if (source === "adapter") throw classify(cause);
    return report(unknown("scope-unavailable"), parsed.requiredDepth, source, undefined, classify(cause));
  }
  const observation = new Observation(context, scope);
  let decision: Decision, diagnostic: VbdError | undefined;
  try { decision = await assess(observation, parsed.requiredDepth); }
  catch (cause) { diagnostic = classify(cause); decision = unknown(failureReason(diagnostic)); }
  // Also check rejected reads and all validation/unsupported branches.
  try { observation.check(); }
  catch (cause) {
    diagnostic = new VbdError("CONFIG_EXPIRED", {
      operation: "security.scope", cause: { scope: cause, ...(diagnostic === undefined ? {} : { read: diagnostic }) }
    });
    decision = unknown("scope-changed");
  }
  return report(decision, parsed.requiredDepth, source, scope, diagnostic);
}
function decodeDepth(value: string | number, encoding: SecurityDepthEncoding): PrivilegeDepth | undefined {
  if (encoding === "semantic") {
    const parsed = depthSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  }
  // Microsoft.Crm.Sdk.Messages.PrivilegeDepth: 0/1/2/3.
  // Its documented LINQ constants are masks 1/2/4/8, not ordinal depths.
  if (encoding === "sdk-enum" && typeof value === "number") return depths[value];
  if (encoding === "privilege-mask") {
    switch (value) { case 1: return "basic"; case 2: return "local"; case 4: return "deep"; case 8: return "global"; }
  }
  return undefined;
}
async function privilegeDecision(
  observation: Observation, identity: PrivilegeIdentity, required: PrivilegeDepth,
  tablePrivilege?: z.output<typeof tablePrivilegeSchema>
): Promise<Decision> {
  const read = response(privilegeReadSchema, await observation.read("getSecurityRolePrivilegesInfo"));
  observation.checkScope(read.scope);
  if (!read.complete) return unknown("incomplete-privileges");
  if (!plain(read.privileges)) return unknown("invalid-response");
  const entries = Object.entries(read.privileges);
  if (entries.length > 10_000 || Reflect.ownKeys(read.privileges).length !== entries.length) {
    return unknown("invalid-response");
  }
  const ids = new Set<string>(), names = new Set<string>();
  const values: z.output<typeof entrySchema>[] = [];
  for (const [key, value] of entries) {
    if (!plain(value)) return unknown("invalid-response");
    const keyId = guidSchema.safeParse(key), entry = entrySchema.safeParse(value);
    if (!safeKey(key) || !keyId.success || !entry.success || keyId.data !== entry.data.id) {
      return unknown("invalid-response");
    }
    const name = entry.data.privilegeName.toLowerCase();
    if (ids.has(entry.data.id) || names.has(name)) return unknown("ambiguous-privileges");
    ids.add(entry.data.id); names.add(name); values.push(entry.data);
  }
  // A malformed/unsupported depth anywhere prevents treating the dictionary as complete.
  if (read.depthEncoding !== "unverified" &&
      values.some(value => decodeDepth(value.depth, read.depthEncoding) === undefined)) {
    return unknown("unsupported-depth");
  }
  const match = values.find(value => identity.id !== undefined ? value.id === identity.id :
    value.privilegeName.toLowerCase() === identity.name.toLowerCase());
  if (tablePrivilege !== undefined && values.some(value =>
    (value.id === tablePrivilege.PrivilegeId) !==
    (value.privilegeName.toLowerCase() === tablePrivilege.Name.toLowerCase()))) {
    return unknown("ambiguous-privileges");
  }
  if (match === undefined) return { state: "denied", reason: "privilege-absent" };
  const grantedDepth = decodeDepth(match.depth, read.depthEncoding);
  if (grantedDepth === undefined) return unknown("unverified-depth");
  if (tablePrivilege !== undefined && !({
    basic: tablePrivilege.CanBeBasic, local: tablePrivilege.CanBeLocal,
    deep: tablePrivilege.CanBeDeep, global: tablePrivilege.CanBeGlobal
  })[grantedDepth]) return unknown("invalid-response");
  return {
    state: depths.indexOf(grantedDepth) >= depths.indexOf(required) ? "allowed" : "denied",
    reason: depths.indexOf(grantedDepth) >= depths.indexOf(required) ? "depth-sufficient" : "depth-insufficient",
    grantedDepth
  };
}
async function hasPrivilege(identity: PrivilegeIdentity, options: SecurityOptions = {}): Promise<AccessAssessment> {
  const requested = parseInput(identitySchema, identity, "security.hasPrivilege");
  return observe(options, (observation, depth) => privilegeDecision(observation, requested, depth));
}
async function assessTable(
  table: string, operation: TableOperation, options: SecurityOptions = {}
): Promise<AccessAssessment> {
  const name = parseInput(logicalNameSchema, table, "security.assessTable").toLowerCase();
  const requested = parseInput(operationSchema, operation, "security.assessTable");
  return observe(options, async (observation, depth) => {
    const read = response(tableReadSchema, await observation.read("getEntityMetadata", name));
    observation.checkScope(read.scope);
    if (!read.complete) return unknown("incomplete-table-metadata");
    const metadata = response(tableSchema, read.metadata);
    if (metadata.LogicalName !== name) return unknown("invalid-response");
    const ids = new Set<string>(), names = new Set<string>(), types = new Set<number>();
    for (const privilege of metadata.Privileges) {
      if (ids.has(privilege.PrivilegeId) || names.has(privilege.Name.toLowerCase()) ||
          types.has(privilege.PrivilegeType)) return unknown("ambiguous-privileges");
      ids.add(privilege.PrivilegeId); names.add(privilege.Name.toLowerCase()); types.add(privilege.PrivilegeType);
    }
    const privilege = metadata.Privileges.find(value => value.PrivilegeType === operationTypes[requested]);
    if (privilege === undefined || !(privilege.CanBeBasic || privilege.CanBeLocal ||
        privilege.CanBeDeep || privilege.CanBeGlobal)) return unknown("operation-unavailable");
    return privilegeDecision(observation, { id: privilege.PrivilegeId }, depth, privilege);
  });
}

/** Table/current-user UX hints only; never server authorization or effective record access. */
export const Security = Object.freeze({ assessTable, hasPrivilege });
