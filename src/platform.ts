import { z } from "zod";
import { VbdError } from "./errors.js";
import { environmentRoot, guidSchema, isRecord, parseInput } from "./validation.js";

export interface ReadScope {
  environmentUrl: string;
  userId: string;
  languageId: number;
  online: boolean;
}

export interface ReadContext {
  getScope(): ReadScope;
  retrieveMultipleRecords(table: string, query: string, maximumPageSize: number): Promise<unknown>;
}

export const contextSchema = z.custom<ReadContext>((value) =>
  isRecord(value) && typeof value.getScope === "function" &&
  typeof value.retrieveMultipleRecords === "function"
);

const scopeSchema = z.object({
  environmentUrl: z.string(),
  userId: guidSchema,
  languageId: z.number().int().min(1).max(65535),
  online: z.boolean()
}).strict();

export function readScope(context: ReadContext): ReadScope {
  let input: unknown;
  try {
    input = context.getScope();
  } catch (cause) {
    if (cause instanceof VbdError) {
      throw cause;
    }
    throw new VbdError("UNSUPPORTED_SURFACE", { operation: "environment.scope", cause });
  }
  const scope = parseInput(scopeSchema, input, "environment.scope");
  if (!scope.online) {
    throw new VbdError("UNSUPPORTED_SURFACE", { operation: "environment.scope" });
  }
  return { ...scope, environmentUrl: environmentRoot(scope.environmentUrl).origin };
}

export function scopeKey(scope: ReadScope): string {
  return JSON.stringify([scope.environmentUrl, scope.userId, scope.languageId]);
}

export function resolveReadContext(supplied?: ReadContext): ReadContext {
  if (supplied !== undefined) {
    return parseInput(contextSchema, supplied, "environment.context");
  }
  const xrm: unknown = Reflect.get(globalThis, "Xrm");
  if (!isRecord(xrm) || !isRecord(xrm.Utility) || !isRecord(xrm.WebApi) ||
      typeof xrm.Utility.getGlobalContext !== "function" ||
      typeof xrm.WebApi.retrieveMultipleRecords !== "function") {
    throw new VbdError("UNSUPPORTED_SURFACE", { operation: "environment.context" });
  }
  const utility = xrm.Utility;
  const webApi = xrm.WebApi;
  const getContext = utility.getGlobalContext;
  const retrieve = webApi.retrieveMultipleRecords;
  if (typeof getContext !== "function" || typeof retrieve !== "function") {
    throw new VbdError("UNSUPPORTED_SURFACE", { operation: "environment.context" });
  }
  return {
    getScope: () => {
      const current: unknown = Reflect.apply(getContext, utility, []);
      if (!isRecord(current) || typeof current.getClientUrl !== "function" ||
          !isRecord(current.userSettings) || !isRecord(current.client) ||
          typeof current.client.getClientState !== "function") {
        throw new VbdError("UNSUPPORTED_SURFACE", { operation: "environment.context" });
      }
      const url: unknown = Reflect.apply(current.getClientUrl, current, []);
      const state: unknown = Reflect.apply(current.client.getClientState, current.client, []);
      return parseInput(scopeSchema, {
        environmentUrl: url,
        userId: current.userSettings.userId,
        languageId: current.userSettings.languageId,
        online: state === "Online"
      }, "environment.context");
    },
    retrieveMultipleRecords: (table, query, maximumPageSize) => {
      const result: unknown = Reflect.apply(retrieve, webApi, [table, query, maximumPageSize]);
      return Promise.resolve(result);
    }
  };
}

export async function readRows(context: ReadContext, table: string, query: string): Promise<unknown[]> {
  let response: unknown;
  try {
    response = await context.retrieveMultipleRecords(table, query, 2);
  } catch (cause) {
    if (cause instanceof VbdError) {
      throw cause;
    }
    const denied = isRecord(cause) &&
      (cause.status === 401 || cause.status === 403 ||
       (typeof cause.errorCode === "number" && (cause.errorCode >>> 0) === 0x80040220));
    throw new VbdError(denied ? "ACCESS_DENIED" : "DATA_READ_FAILED", {
      operation: "environment.read", cause
    });
  }
  if (!isRecord(response) || !Array.isArray(response.entities)) {
    throw new VbdError("DATA_RESPONSE_INVALID", { operation: "environment.read" });
  }
  if (response.entities.length > 1 || response.nextLink) {
    throw new VbdError("CONFIG_AMBIGUOUS", { operation: "environment.read" });
  }
  return response.entities;
}
