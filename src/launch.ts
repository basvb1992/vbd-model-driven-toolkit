import { z } from "zod";
import { Config, configurationRevision } from "./configuration.js";
import type { ToolkitConfiguration } from "./configuration.js";
import { Environment, environmentGeneration } from "./environment.js";
import { VbdError } from "./errors.js";
import { Links } from "./links.js";
import { contextSchema, readScope, resolveReadContext, scopeKey } from "./platform.js";
import type { ReadContext } from "./platform.js";
import { identifierSchema, isRecord, parseInput } from "./validation.js";
import { Windows, windowHostSchema } from "./windows.js";
import type { LaunchResult } from "./windows.js";

const profileIdentity = z.object({
  configurationName: identifierSchema,
  profileKey: identifierSchema
}).strict();
const preparationOptions = profileIdentity.extend({
  context: contextSchema.optional(),
  ttlMs: z.number().int().min(1).max(300_000).default(60_000)
});
const openOptions = z.object({
  host: windowHostSchema.optional(),
  width: z.number().int().min(100).max(4096).optional(),
  height: z.number().int().min(100).max(4096).optional()
}).strict();
export type ProfileIdentity = z.input<typeof profileIdentity>;
export type PreparationOptions = z.input<typeof preparationOptions>;
export type ProfileDefinition = ToolkitConfiguration["launchProfiles"][number];
export interface PreparedLaunch {
  readonly id: string;
  readonly expiresAt: number;
}
export interface SameWindowHost {
  navigateSameWindow(url: string): void | Promise<void>;
}
const sameWindowOptions = preparationOptions.extend({
  host: z.custom<SameWindowHost>(value =>
    isRecord(value) && typeof value.navigateSameWindow === "function").optional()
});
export type OpenProfileOptions = z.input<typeof sameWindowOptions>;
export interface SameWindowResult {
  status: "requested";
  outcome: "unknown";
  presentation: "sameWindow";
}
interface PreparedState {
  url: string;
  allowedOrigins: string[];
  configurationName: string;
  revision: number;
  generation: number;
  scope: string;
  context: ReadContext | undefined;
  createdAt: number;
}
const prepared = new Map<PreparedLaunch, PreparedState>();

function getProfile(input: ProfileIdentity): ProfileDefinition {
  const options = parseInput(profileIdentity, input, "launch.getProfile");
  const configuration = Config.get(options.configurationName);
  const profile = configuration.launchProfiles.find((item) => item.key === options.profileKey);
  if (!profile) {
    throw new VbdError("CONFIG_NOT_FOUND", { operation: "launch.getProfile" });
  }
  return profile;
}

function requirePresentation(profile: ProfileDefinition, expected: "newWindow" | "sameWindow"): void {
  const presentation: string = profile.presentation;
  if (presentation !== expected) throw new VbdError("INVALID_ARGUMENT", { operation: "launch.presentation" });
}

async function resolveProfile(input: PreparationOptions, presentation: "newWindow" | "sameWindow"):
Promise<PreparedState & { expiresAt: number }> {
  const options = parseInput(preparationOptions, input, "launch.prepareProfile");
  const identity = { configurationName: options.configurationName, profileKey: options.profileKey };
  const profile = getProfile(identity);
  requirePresentation(profile, presentation);
  const revision = configurationRevision(options.configurationName);
  const generation = environmentGeneration();
  const context = resolveReadContext(options.context);
  const scope = readScope(context);
  const scopeIdentity = scopeKey(scope);
  const bindings = [
    profile.appId.environmentVariable,
    ...profile.allowedOrigins.map((entry) => entry.environmentVariable),
    ...(profile.environmentUrl ? [profile.environmentUrl.environmentVariable] : [])
  ];
  const values = new Map<string, string>();
  const freshness: number[] = [];
  const resolutions = await Promise.allSettled([...new Set(bindings)].map(async (schemaName) => {
    const result = await Environment.getText(schemaName, {
      context, cacheTtlMs: options.ttlMs, trim: true
    });
    values.set(schemaName, result.value);
    freshness.push(result.expiresAt);
  }));
  const failure = resolutions.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") {
    throw failure.reason;
  }
  if (revision !== configurationRevision(options.configurationName) ||
      generation !== environmentGeneration() || scopeKey(readScope(context)) !== scopeIdentity) {
    throw new VbdError("CONFIG_EXPIRED", { operation: "launch.prepareProfile" });
  }
  function required(name: string): string {
    const value = values.get(name);
    if (value === undefined) {
      throw new VbdError("CONFIG_VALUE_MISSING", { operation: "launch.prepareProfile" });
    }
    return value;
  }
  const allowedOrigins = profile.allowedOrigins.map((entry) => required(entry.environmentVariable));
  const url = Links.app({
    environmentUrl: profile.environmentUrl ? required(profile.environmentUrl.environmentVariable) : scope.environmentUrl,
    appId: required(profile.appId.environmentVariable),
    allowedOrigins
  });
  const createdAt = Date.now();
  const expiresAt = Math.min(createdAt + options.ttlMs, ...freshness);
  if (expiresAt <= createdAt) {
    throw new VbdError("CONFIG_EXPIRED", { operation: "launch.prepareProfile" });
  }
  return {
    url, allowedOrigins, configurationName: options.configurationName, revision,
    generation, scope: scopeIdentity, context: options.context, createdAt, expiresAt
  };
}

async function prepareProfile(input: PreparationOptions): Promise<PreparedLaunch> {
  const { expiresAt, ...state } = await resolveProfile(input, "newWindow");
  assertCurrent(state, expiresAt);
  const createdAt = state.createdAt;
  for (const token of prepared.keys()) {
    if (token.expiresAt <= createdAt) {
      prepared.delete(token);
    }
  }
  if (prepared.size >= 128) {
    const oldest = prepared.keys().next().value;
    if (oldest !== undefined) {
      prepared.delete(oldest);
    }
  }
  const token: PreparedLaunch = Object.freeze({ id: crypto.randomUUID(), expiresAt });
  prepared.set(token, state);
  return token;
}

function assertCurrent(state: PreparedState, expiresAt: number): void {
  const now = Date.now();
  const currentScope = scopeKey(readScope(resolveReadContext(state.context)));
  if (now < state.createdAt || now >= expiresAt ||
      state.revision !== configurationRevision(state.configurationName) ||
      state.generation !== environmentGeneration() || state.scope !== currentScope) {
    throw new VbdError("CONFIG_EXPIRED", { operation: "launch.freshness" });
  }
}

function browserSameWindowHost(): SameWindowHost {
  try {
    const window: unknown = Reflect.get(globalThis, "window");
    if (window !== globalThis || Reflect.get(globalThis, "self") !== window ||
        Reflect.get(globalThis, "top") !== window) {
      throw new VbdError("UNSUPPORTED_SURFACE", { operation: "launch.sameWindowHost" });
    }
    const location: unknown = Reflect.get(globalThis, "location");
    if (!isRecord(location)) {
      throw new VbdError("UNSUPPORTED_SURFACE", { operation: "launch.sameWindowHost" });
    }
    const assign = location.assign;
    if (typeof assign !== "function") {
      throw new VbdError("UNSUPPORTED_SURFACE", { operation: "launch.sameWindowHost" });
    }
    return { navigateSameWindow: url => { Reflect.apply(assign, location, [url]); } };
  } catch (cause) {
    if (cause instanceof VbdError) throw cause;
    throw new VbdError("UNSUPPORTED_SURFACE", { operation: "launch.sameWindowHost", cause });
  }
}

async function openProfile(input: OpenProfileOptions): Promise<SameWindowResult> {
  const { host: suppliedHost, ...options } = parseInput(sameWindowOptions, input, "launch.openProfile");
  requirePresentation(getProfile({
    configurationName: options.configurationName, profileKey: options.profileKey
  }), "sameWindow");
  const host = suppliedHost ?? browserSameWindowHost();
  const { expiresAt, ...state } = await resolveProfile(options, "sameWindow");
  try {
    const navigate = host.navigateSameWindow;
    if (typeof navigate !== "function") {
      throw new VbdError("INVALID_ARGUMENT", { operation: "launch.openProfile" });
    }
    assertCurrent(state, expiresAt);
    const pending: unknown = Reflect.apply(navigate, host, [state.url]);
    if (pending !== undefined && (!isRecord(pending) || typeof pending.then !== "function")) {
      throw new VbdError("DATA_RESPONSE_INVALID", { operation: "launch.openProfile" });
    }
    if (await pending !== undefined) {
      throw new VbdError("DATA_RESPONSE_INVALID", { operation: "launch.openProfile" });
    }
  } catch (cause) {
    if (cause instanceof VbdError) throw cause;
    throw new VbdError("WINDOW_REQUEST_FAILED", { operation: "launch.openProfile", cause });
  }
  return { status: "requested", outcome: "unknown", presentation: "sameWindow" };
}

function openPrepared(token: PreparedLaunch, input: z.input<typeof openOptions> = {}): LaunchResult {
  const options = parseInput(openOptions, input, "launch.openPrepared");
  const state = prepared.get(token);
  if (!state) {
    throw new VbdError("CONFIG_NOT_READY", { operation: "launch.openPrepared" });
  }
  try {
    assertCurrent(state, token.expiresAt);
  } catch (error) {
    prepared.delete(token);
    throw error;
  }
  return Windows.open({
    url: state.url, allowedOrigins: state.allowedOrigins,
    ...(options.host === undefined ? {} : { host: options.host }),
    ...(options.width === undefined ? {} : { width: options.width }),
    ...(options.height === undefined ? {} : { height: options.height })
  });
}

export const Launch = Object.freeze({ getProfile, prepareProfile, openPrepared, openProfile });
