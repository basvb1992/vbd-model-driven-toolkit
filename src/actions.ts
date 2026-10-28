import { z } from "zod";
import { VbdError } from "./errors.js";
import { entityReference } from "./entity-reference.js";
import type { EntityRef } from "./entity-reference.js";
import { guidSchema, isRecord, parseInput } from "./validation.js";
import {
  fail, jsonValue, ownKeys, plain, safeKey, session
} from "./data-core.js";
import type { ClientOptions, JsonValue, OperationMetadata, OperationRequest } from "./data-core.js";

export interface ParameterContract {
  typeName: string;
  /** 1 primitive, 2 complex, 4 collection, 5 entity. Enumerations are not inferred. */
  structuralProperty: 1 | 2 | 4 | 5;
  nullable: boolean;
  /** Synchronous only; validates each collection element. Must return proven JSON, never a thenable. */
  validate?: (input: unknown) => JsonValue;
}
export type ResponseContract<T> =
  | { kind: "empty"; status: 200 | 201 | 204 }
  | { kind: "json"; status: 200 | 201; validate: (input: unknown) => T | PromiseLike<T> };
export interface OperationContract<T> {
  operationName: string;
  parameters: Record<string, ParameterContract>;
  binding?: { parameter: string; entityType: string; typeName: string };
  response: ResponseContract<T>;
}
export interface OperationOptions extends ClientOptions { binding?: EntityRef }

const operationName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,127}$/);
const parameterName = operationName.refine(safeKey);
const qualifiedType = /^[A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*$/;
const primitives = new Set([
  "Edm.String", "Edm.Boolean", "Edm.Int32", "Edm.Int64", "Edm.Double", "Edm.Decimal",
  "Edm.Guid", "Edm.DateTimeOffset"
]);
function validateParameterContract(input: ParameterContract): void {
  if (!plain(input)) { fail(); }
  ownKeys(input, ["typeName", "structuralProperty", "nullable", "validate"]);
  if (typeof input.typeName !== "string" || input.typeName.length > 256 ||
      typeof input.nullable !== "boolean" || ![1, 2, 4, 5].includes(input.structuralProperty) ||
      input.validate !== undefined && typeof input.validate !== "function") { fail(); }
  if (input.structuralProperty === 1) {
    if (!primitives.has(input.typeName)) { fail(); }
  } else if (input.structuralProperty === 4) {
    const match = /^Collection\(([^()]+)\)$/.exec(input.typeName);
    const element = match?.[1];
    if (!element || !qualifiedType.test(element) || (!primitives.has(element) &&
        (element.startsWith("Edm.") || !input.validate))) { fail(); }
  } else if (!qualifiedType.test(input.typeName) || input.typeName.startsWith("Edm.") || !input.validate) {
    fail();
  }
}
function primitive(value: unknown, type: string): JsonValue {
  switch (type) {
    case "Edm.String": return parseInput(z.string().max(65_536), value, "actions.parameter");
    case "Edm.Boolean": return parseInput(z.boolean(), value, "actions.parameter");
    case "Edm.Int32": return parseInput(z.number().int().min(-2147483648).max(2147483647), value, "actions.parameter");
    case "Edm.Int64": return parseInput(z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
      value, "actions.parameter");
    case "Edm.Decimal":
    case "Edm.Double": return parseInput(z.number().finite(), value, "actions.parameter");
    case "Edm.Guid": return parseInput(guidSchema, value, "actions.parameter");
    case "Edm.DateTimeOffset":
      return parseInput(z.iso.datetime({ offset: true }), value, "actions.parameter");
    default: return fail();
  }
}
function parameter(value: unknown, metadata: ParameterContract): JsonValue {
  if (value === null) { return metadata.nullable ? null : fail(); }
  if (metadata.structuralProperty === 1) {
    const parsed = primitive(value, metadata.typeName);
    return metadata.validate ? jsonValue(metadata.validate(parsed)) : parsed;
  }
  if (metadata.structuralProperty === 4) {
    if (!Array.isArray(value) || value.length > 1000) { return fail(); }
    const elementType = metadata.typeName.slice(11, -1);
    return value.map((entry) => {
      if (entry === null) { return fail(); }
      if (primitives.has(elementType)) {
        const parsed = primitive(entry, elementType);
        return metadata.validate ? jsonValue(metadata.validate(parsed)) : parsed;
      }
      if (!metadata.validate) { return fail(); }
      return jsonValue(metadata.validate(entry));
    });
  }
  if (!plain(value) || !metadata.validate) { return fail(); }
  const validated = jsonValue(metadata.validate(value));
  if (!plain(validated)) { return fail(); }
  return validated;
}
function responseContract<T>(contract: ResponseContract<T>): void {
  if (!plain(contract)) { fail(); }
  if (contract.kind === "empty") {
    ownKeys(contract, ["kind", "status"]);
    if (![200, 201, 204].includes(contract.status)) { fail(); }
  } else if (contract.kind === "json") {
    ownKeys(contract, ["kind", "status", "validate"]);
    if (![200, 201].includes(contract.status) || typeof contract.validate !== "function") { fail(); }
  } else { fail(); }
}
async function execute<T>(kind: 0 | 1, contract: OperationContract<T>, parameters: Record<string, unknown>,
  options: OperationOptions = {}): Promise<Awaited<T> | undefined> {
  const suppliedContext = options?.context;
  if (!plain(contract) || !plain(parameters) || !plain(options)) { return fail(); }
  ownKeys(contract, ["operationName", "parameters", "binding", "response"]);
  ownKeys(options, ["context", "binding"]);
  const name = parseInput(operationName, contract.operationName, "actions.contract");
  if (!plain(contract.parameters) || Object.keys(contract.parameters).length > 100) { return fail(); }
  responseContract(contract.response);
  const responsePolicy = { ...contract.response };
  const request: OperationRequest = { getMetadata: () => metadata };
  const metadata: OperationMetadata = {
    boundParameter: null, operationType: kind, operationName: name, parameterTypes: {}
  };
  for (const [key, declared] of Object.entries(contract.parameters)) {
    parseInput(parameterName, key, "actions.parameter");
    validateParameterContract(declared);
    if (!Object.hasOwn(parameters, key)) { return fail(); }
    metadata.parameterTypes[key] = { typeName: declared.typeName, structuralProperty: declared.structuralProperty };
    try { request[key] = parameter(parameters[key], declared); }
    catch (cause) { return fail("INVALID_ARGUMENT", cause); }
  }
  if (Object.keys(parameters).some((key) => !Object.hasOwn(contract.parameters, key))) { return fail(); }
  if (contract.binding !== undefined) {
    if (!plain(contract.binding)) { return fail(); }
    ownKeys(contract.binding, ["parameter", "entityType", "typeName"]);
    const key = parseInput(parameterName, contract.binding.parameter, "actions.binding");
    if (Object.hasOwn(contract.parameters, key)) { return fail(); }
    const ref = entityReference(options.binding);
    // Both names are declared metadata, not inferred from parameter values.
    if (ref.entityType !== contract.binding.entityType || contract.binding.typeName !== `mscrm.${ref.entityType}`) {
      return fail();
    }
    metadata.boundParameter = key;
    metadata.parameterTypes[key] = { typeName: contract.binding.typeName, structuralProperty: 5 };
    request[key] = { entityType: ref.entityType, id: ref.id };
  } else if (options.binding !== undefined) { return fail(); }
  // Enforce one total request-value bound, in addition to individual parameter bounds.
  jsonValue(Object.fromEntries(Object.entries(request).filter(([key]) => key !== "getMetadata")));
  const bound = session(suppliedContext === undefined ? {} : { context: suppliedContext });
  const method = bound.context.execute;
  if (typeof method !== "function") { return fail("UNSUPPORTED_SURFACE"); }
  const response = await bound.run(() => method.call(bound.context, request), (value) => {
    if (!isRecord(value) || Array.isArray(value) || typeof value.ok !== "boolean" ||
        typeof value.status !== "number" || !Number.isInteger(value.status)) {
      return fail("DATA_RESPONSE_INVALID");
    }
    if (!value.ok || value.status < 200 || value.status > 299) {
      // Some typed adapters expose HTTP failure responses rather than rejecting.
      if (value.status === 401 || value.status === 403) { return fail("ACCESS_DENIED", value); }
      if (value.status === 412) { return fail("CONCURRENCY_CONFLICT", value); }
      return fail("ACTION_FAILED", value);
    }
    if (value.status !== responsePolicy.status) { return fail("DATA_RESPONSE_INVALID"); }
    if (responsePolicy.kind === "empty") { return undefined; }
    if (typeof value.json !== "function") { return fail("DATA_RESPONSE_INVALID"); }
    return { response: value, json: value.json };
  }, kind === 0, true);
  if (response === undefined) { return undefined; }
  // The body is a second await: retain the same environment/user/language scope.
  try {
    return await bound.run(
      () => {
        const body: unknown = Reflect.apply(response.json, response.response, []);
        return Promise.resolve(body);
      },
      (value) => {
        if (responsePolicy.kind !== "json") { return fail("DATA_RESPONSE_INVALID"); }
        const bounded = jsonValue(value);
        return responsePolicy.validate(bounded);
      }, kind === 0, true
    );
  } catch (cause) {
    if (kind === 0 && (!(cause instanceof VbdError) || cause.code !== "MUTATION_OUTCOME_UNKNOWN")) {
      return fail("MUTATION_OUTCOME_UNKNOWN", cause);
    }
    throw cause;
  }
}
function executeAction<T>(contract: OperationContract<T>, parameters: Record<string, unknown>,
  options?: OperationOptions): Promise<Awaited<T> | undefined> {
  return execute(0, contract, parameters, options);
}
function executeFunction<T>(contract: OperationContract<T>, parameters: Record<string, unknown>,
  options?: OperationOptions): Promise<Awaited<T> | undefined> {
  return execute(1, contract, parameters, options);
}
export const Actions = Object.freeze({ executeAction, executeFunction });
