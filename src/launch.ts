import { z } from "zod";
import { Config, configurationRevision } from "./configuration.js";
import type { ToolkitConfiguration } from "./configuration.js";
import { Environment, environmentGeneration } from "./environment.js";
import { VbdError } from "./errors.js";
import { Links } from "./links.js";
import { contextSchema, readScope, resolveReadContext, scopeKey } from "./platform.js";
import type { ReadContext } from "./platform.js";
import { identifierSchema, parseInput } from "./validation.js";
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

async function prepareProfile(input: PreparationOptions): Promise<PreparedLaunch> {
  const options = parseInput(preparationOptions, input, "launch.prepareProfile");
  const identity = { configurationName: options.configurationName, profileKey: options.profileKey };
  const profile = getProfile(identity);
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
  prepared.set(token, {
    url, allowedOrigins, configurationName: options.configurationName, revision,
    generation, scope: scopeIdentity, context: options.context, createdAt
  });
  return token;
}

function openPrepared(token: PreparedLaunch, input: z.input<typeof openOptions> = {}): LaunchResult {
  const options = parseInput(openOptions, input, "launch.openPrepared");
  const state = prepared.get(token);
  if (!state) {
    throw new VbdError("CONFIG_NOT_READY", { operation: "launch.openPrepared" });
  }
  const now = Date.now();
  let currentScope: string;
  try {
    currentScope = scopeKey(readScope(resolveReadContext(state.context)));
  } catch (error) {
    prepared.delete(token);
    throw error;
  }
  if (now < state.createdAt || now >= token.expiresAt ||
      state.revision !== configurationRevision(state.configurationName) ||
      state.generation !== environmentGeneration() ||
      state.scope !== currentScope) {
    prepared.delete(token);
    throw new VbdError("CONFIG_EXPIRED", { operation: "launch.openPrepared" });
  }
  return Windows.open({
    url: state.url, allowedOrigins: state.allowedOrigins,
    ...(options.host === undefined ? {} : { host: options.host }),
    ...(options.width === undefined ? {} : { width: options.width }),
    ...(options.height === undefined ? {} : { height: options.height })
  });
}

export const Launch = Object.freeze({ getProfile, prepareProfile, openPrepared });
