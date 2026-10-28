import { z } from "zod";
import { Config, configurationRevision } from "./configuration.js";
import type { ConfigurationResolveOptions } from "./configuration-runtime.js";
import { Context } from "./context.js";
import type { OperationContext } from "./context.js";
import { plain, safeKey } from "./data-core.js";
import { entityRefSchema } from "./entity-reference.js";
import { Environment } from "./environment.js";
import type { EnvironmentGetOptions } from "./environment.js";
import { Fields } from "./forms.js";
import { contextSchema, readScope } from "./platform.js";
import type { ReadContext } from "./platform.js";
import { dateMilliseconds } from "./utils.js";
import { identifierSchema, logicalNameSchema, parseInput } from "./validation.js";
import { copyRuntimeJson, runtimeFail, runtimePredicate, runtimeSnapshot } from "./configuration-values.js";

export type BindingType = "text" | "number" | "boolean" | "json" | "date" | "lookup" | "choices";
export type BindingSource =
  | { kind: "literal"; value: unknown }
  | { kind: "context"; key: "record" | "selection" | "userId" | "languageId" | "environmentUrl" }
  | { kind: "field"; column: string }
  | { kind: "environment"; schemaName: string }
  | { kind: "config"; key: string }
  | { kind: "config"; name: string; variable: string }
  | { kind: "result"; path: readonly string[] };
export interface ValueBinding {
  source: BindingSource;
  type: BindingType;
  allowEmpty?: boolean | undefined;
  nullable?: boolean | undefined;
  /** Mandatory for JSON; optional additional predicate for other types. Synchronous only. */
  validate?: ((value: unknown) => boolean) | undefined;
}
export interface BindingOptions {
  context?: ReadContext;
  operationContext?: OperationContext;
  /** Exact field/environment/path approvals. An omitted approval list grants nothing. */
  fields?: readonly string[];
  environment?: readonly string[];
  resultPaths?: readonly (readonly string[])[];
  results?: Readonly<Record<string, unknown>>;
  /** Bounded runtime binding graph, separate from portable version-1 configuration. */
  configuration?: Readonly<Record<string, ValueBinding>>;
  /** Exact registered configuration/variable approvals. No general registry traversal. */
  registered?: readonly { name: string; variable: string }[];
  configurationOptions?: Readonly<Record<string, Omit<ConfigurationResolveOptions, "context">>>;
}
const safeName = identifierSchema.refine(safeKey);
const pathSchema = z.array(z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_-]{0,127}$/).refine(safeKey)).min(1).max(8);
const predicate = z.custom<(value: unknown) => boolean>(value => typeof value === "function");
const sourceSchema = z.union([
  z.object({ kind: z.literal("literal"), value: z.unknown() }).strict(),
  z.object({
    kind: z.literal("context"), key: z.enum(["record", "selection", "userId", "languageId", "environmentUrl"])
  }).strict(),
  z.object({ kind: z.literal("field"), column: logicalNameSchema }).strict(),
  z.object({ kind: z.literal("environment"), schemaName: logicalNameSchema }).strict(),
  z.object({ kind: z.literal("config"), key: safeName }).strict(),
  z.object({ kind: z.literal("config"), name: safeName, variable: logicalNameSchema }).strict(),
  z.object({ kind: z.literal("result"), path: pathSchema }).strict()
]);
const bindingSchema = z.object({
  source: sourceSchema,
  type: z.enum(["text", "number", "boolean", "json", "date", "lookup", "choices"]),
  allowEmpty: z.boolean().optional(), nullable: z.boolean().optional(), validate: predicate.optional()
}).strict().superRefine((binding, ctx) => {
  if ((binding.type === "json" && !binding.validate) ||
      (binding.allowEmpty !== undefined && binding.type !== "text")) {
    ctx.addIssue({ code: "custom", message: "Invalid type policy." });
  }
});
const optionsSchema = z.object({
  context: contextSchema.optional(), operationContext: z.custom<OperationContext>().optional(),
  fields: z.array(logicalNameSchema).max(100).default([]),
  environment: z.array(logicalNameSchema).max(100).default([]),
  resultPaths: z.array(pathSchema).max(100).default([]),
  results: z.custom<Readonly<Record<string, unknown>>>(plain).optional(),
  configuration: z.record(safeName, bindingSchema).default({}),
  registered: z.array(z.object({ name: safeName, variable: logicalNameSchema }).strict()).max(100).default([]),
  configurationOptions: z.record(safeName, z.object({
    cacheTtlMs: z.number().int().min(0).max(300_000).optional(),
    variables: z.record(safeName, z.object({
      allowEmpty: z.boolean().optional(), validate: predicate.optional()
    }).strict()).optional()
  }).strict()).default({})
}).strict();

function copyValue(value: unknown, type: BindingType): unknown {
  if (type === "date" && value !== null) {
    const time = dateMilliseconds(value);
    if (time === undefined) runtimeFail("CONFIG_VALUE_INVALID");
    return new Date(time);
  }
  if (type === "lookup" && value !== null) {
    // Preflight rejects accessors, cycles and unsafe properties before normalizing references.
    return parseInput(z.array(entityRefSchema).max(1000), copyRuntimeJson(value), "bindings.lookup");
  }
  return copyRuntimeJson(value);
}
function checkType(value: unknown, binding: ValueBinding): void {
  if (value === null && binding.nullable === true) return;
  switch (binding.type) {
    case "text":
      if (typeof value !== "string" || (!binding.allowEmpty && value.length === 0)) runtimeFail("CONFIG_VALUE_INVALID");
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) runtimeFail("CONFIG_VALUE_INVALID");
      break;
    case "boolean":
      if (typeof value !== "boolean") runtimeFail("CONFIG_VALUE_INVALID");
      break;
    case "date":
      if (dateMilliseconds(value) === undefined) runtimeFail("CONFIG_VALUE_INVALID");
      break;
    case "lookup": {
      const refs = z.array(entityRefSchema).max(1000).safeParse(value);
      if (!refs.success) runtimeFail("CONFIG_VALUE_INVALID");
      if (new Set(refs.data.map(ref => JSON.stringify([ref.entityType, ref.id]))).size !== refs.data.length) {
        runtimeFail("CONFIG_VALUE_INVALID");
    }
      break;
      }
    case "choices": {
      const choices = z.array(z.number().int()).max(1000).safeParse(value);
      if (!choices.success || new Set(choices.data).size !== choices.data.length) runtimeFail("CONFIG_VALUE_INVALID");
      break;
    }
    case "json": break; // The required predicate also decides whether JSON null is valid.
  }
}
function ownPath(input: unknown, path: readonly string[]): unknown {
  let value = input;
  for (const key of path) {
    if ((!plain(value) && !Array.isArray(value)) || !safeKey(key)) runtimeFail();
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !("value" in property) || !property.enumerable) runtimeFail("CONFIG_VALUE_MISSING");
    value = property.value;
  }
  return value;
}

async function resolveMany(
  input: Readonly<Record<string, ValueBinding>>, settings: BindingOptions = {}
): Promise<Record<string, unknown>> {
  const bindings = parseInput(z.record(safeName, bindingSchema), input, "bindings.resolveMany");
  const options = parseInput(optionsSchema, settings, "bindings.resolveMany");
  if (Object.keys(bindings).length < 1 || Object.keys(bindings).length > 100 ||
      Object.keys(options.configuration).length > 100 || Object.keys(options.configurationOptions).length > 100) {
    runtimeFail("LIMIT_EXCEEDED");
  }
  const snapshot = runtimeSnapshot(options.context);
  const revisions = new Map<string, number>();
  const check = () => {
    snapshot.check();
    for (const [name, revision] of revisions) {
      if (configurationRevision(name) !== revision) runtimeFail("CONFIG_EXPIRED");
    }
  };
  let bytes = 0;
  const account = (value: unknown) => {
    bytes += new TextEncoder().encode(JSON.stringify(value)).byteLength;
    if (bytes > 262_144) runtimeFail("LIMIT_EXCEEDED");
  };
  // Capture all relevant registry revisions and literal values before asynchronous work.
  const allBindings = [...Object.values(bindings), ...Object.values(options.configuration)];
  for (const binding of allBindings) {
    const source = binding.source;
    if (source.kind === "config" && "name" in source) {
      Config.get(source.name);
      revisions.set(source.name, configurationRevision(source.name));
    }
    if (source.kind === "literal") {
      source.value = copyValue(source.value, binding.type);
      account(source.value);
    }
  }
  // Copy approved results eagerly, including Dates, without serializing them into strings.
  const resultValues = new Map<string, unknown>();
  for (const binding of allBindings) {
    if (binding.source.kind === "result") {
      const path = binding.source.path;
      if (!options.resultPaths.some(approved => JSON.stringify(approved) === JSON.stringify(path))) runtimeFail();
      const value = copyValue(ownPath(options.results, path), binding.type);
      account(value);
      resultValues.set(JSON.stringify([path, binding.type]), value);
    }
  }
  const resolving = new Set<string>();
  let count = 0;
  const visit = async (binding: ValueBinding, depth: number): Promise<unknown> => {
    if (++count > 100 || depth > 8) runtimeFail("LIMIT_EXCEEDED");
    check();
    const source = binding.source;
    let value: unknown;
    try {
    switch (source.kind) {
      case "literal": value = source.value; break;
      case "context": {
        if (source.key === "record" || source.key === "selection") {
          if (!options.operationContext) runtimeFail();
          value = source.key === "record" ? Context.requireSavedRecord(options.operationContext)
            : Context.getSelection(options.operationContext);
        } else {
          const scope = readScope(snapshot.context);
          value = scope[source.key];
        }
        break;
      }
      case "field":
        if (!options.fields.includes(source.column) || !options.operationContext) runtimeFail();
        value = Fields.get(options.operationContext, source.column);
        break;
      case "environment": {
        if (!options.environment.includes(source.schemaName) ||
            !["text", "number", "boolean", "json"].includes(binding.type)) runtimeFail();
        let request: EnvironmentGetOptions;
        switch (binding.type) {
          case "text": request = { type: "text", allowEmpty: binding.allowEmpty ?? false }; break;
          case "number": request = { type: "number" }; break;
          case "boolean": request = { type: "boolean" }; break;
          default: request = {
            type: "json", validate: candidate => {
              check();
              if (!binding.validate) runtimeFail();
              try { runtimePredicate(binding.validate, copyRuntimeJson(candidate)); }
              finally { check(); }
              return true;
            }
          };
        }
        value = (await Environment.get(source.schemaName, { ...request, context: snapshot.context })).value;
        break;
      }
      case "config":
        if ("key" in source) {
          if (resolving.has(source.key)) runtimeFail();
          const target = Object.getOwnPropertyDescriptor(options.configuration, source.key)?.value as ValueBinding | undefined;
          if (!target) runtimeFail("CONFIG_NOT_FOUND");
          resolving.add(source.key);
          try { value = await visit(target, depth + 1); }
          finally { resolving.delete(source.key); }
        } else {
          if (!options.registered.some(item => item.name === source.name && item.variable === source.variable)) runtimeFail();
          const resolved = await Config.resolve(source.name, {
            ...options.configurationOptions[source.name], context: snapshot.context
          });
          const result = Object.getOwnPropertyDescriptor(resolved.values, source.variable)?.value as
            { value: unknown } | undefined;
          if (!result) runtimeFail("CONFIG_VALUE_MISSING");
          value = result.value;
        }
        break;
      case "result": value = resultValues.get(JSON.stringify([source.path, binding.type])); break;
    }
    check();
    const canonical = copyValue(value, binding.type);
    checkType(canonical, binding);
    try {
      if (binding.validate) runtimePredicate(binding.validate, copyValue(canonical, binding.type));
    } finally { check(); }
    account(canonical);
    return copyValue(canonical, binding.type);
    } finally { check(); }
  };
  const values: Record<string, unknown> = {};
  for (const [key, binding] of Object.entries(bindings)) values[key] = await visit(binding, 0);
  check();
  return values;
}
async function resolve(binding: ValueBinding, options: BindingOptions = {}): Promise<unknown> {
  return (await resolveMany({ value: binding }, options)).value;
}
export const Bindings = Object.freeze({ resolve, resolveMany });
