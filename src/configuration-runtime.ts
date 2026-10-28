import { z } from "zod";
import type { ToolkitConfiguration } from "./configuration.js";
import { Environment } from "./environment.js";
import type { EnvironmentGetOptions, ResolvedValue } from "./environment.js";
import { VbdError } from "./errors.js";
import { contextSchema } from "./platform.js";
import type { ReadContext } from "./platform.js";
import { identifierSchema, parseInput } from "./validation.js";
import { copyRuntimeJson, runtimeFail, runtimePredicate, runtimeSnapshot } from "./configuration-values.js";

export interface TrustedConfigurationSource {
  kind: "trustedJson";
  approved: true;
  /** Trusted adapter only: return bounded JSON text, never script or a parsed object. */
  loadJson(maximumBytes: number): Promise<string>;
}
export interface ConfigurationLoadOptions { context?: ReadContext | undefined; replace?: boolean | undefined }
export interface ConfigurationVariablePolicy {
  allowEmpty?: boolean | undefined;
  /** Required for every JSON declaration, including optional declarations. */
  validate?: ((value: unknown) => boolean) | undefined;
}
export interface ConfigurationResolveOptions {
  context?: ReadContext | undefined;
  cacheTtlMs?: number | undefined;
  variables?: Readonly<Record<string, ConfigurationVariablePolicy>> | undefined;
}
export interface ResolvedConfiguration {
  name: string;
  revision: number;
  configuration: ToolkitConfiguration;
  /** An optional missing definition/value is an own property with value undefined. */
  values: Record<string, ResolvedValue<unknown> | undefined>;
}
interface Registry {
  get(name: string): ToolkitConfiguration;
  revision(name: string): number;
  register(name: string, input: unknown, options: { replace?: boolean }): unknown;
}
const guardSchema = z.custom<(value: unknown) => boolean>(value => typeof value === "function");
const loadOptions = z.object({ context: contextSchema.optional(), replace: z.boolean().optional() }).strict();
const resolveOptions = z.object({
  context: contextSchema.optional(),
  cacheTtlMs: z.number().int().min(0).max(300_000).default(60_000),
  variables: z.record(identifierSchema, z.object({
    allowEmpty: z.boolean().optional(), validate: guardSchema.optional()
  }).strict()).default({})
}).strict();

/** Dependency injection keeps the legacy registry in configuration.ts authoritative. */
export function configurationRuntime(registry: Registry): {
  load(name: string, source: TrustedConfigurationSource, options?: ConfigurationLoadOptions): Promise<ToolkitConfiguration>;
  resolve(name: string, options?: ConfigurationResolveOptions): Promise<ResolvedConfiguration>;
} {
  return {
    async load(name, source, input = {}) {
      parseInput(identifierSchema, name, "config.load");
      const options = parseInput(loadOptions, input, "config.load");
      const approved = parseInput(z.object({
        kind: z.literal("trustedJson"), approved: z.literal(true),
        loadJson: z.custom<(maximumBytes: number) => Promise<string>>(value => typeof value === "function")
      }).strict(), source, "config.load");
      const snapshot = runtimeSnapshot(options.context);
      const revision = registry.revision(name);
      const check = () => {
        snapshot.check();
        if (registry.revision(name) !== revision) runtimeFail("CONFIG_EXPIRED");
      };
      check();
      let text: unknown;
      try { text = await approved.loadJson(262_144); }
      catch (cause) {
        check();
        if (cause instanceof VbdError) throw cause;
        throw new VbdError("DATA_READ_FAILED", { operation: "config.load", cause });
      }
      check();
      if (typeof text !== "string") runtimeFail();
      if (text.length > 262_144 || new TextEncoder().encode(text).byteLength > 262_144) {
        runtimeFail("LIMIT_EXCEEDED");
      }
      let json: unknown;
      try { json = JSON.parse(text); }
      catch (cause) { throw new VbdError("INVALID_JSON", { operation: "config.load", cause }); }
      const value = copyRuntimeJson(json);
      check();
      registry.register(name, value, options.replace === undefined ? {} : { replace: options.replace });
      return registry.get(name);
    },
    async resolve(name, input = {}) {
      const options = parseInput(resolveOptions, input, "config.resolve");
      const configuration = registry.get(name);
      const revision = registry.revision(name);
      const snapshot = runtimeSnapshot(options.context);
      const check = () => {
        snapshot.check();
        if (registry.revision(name) !== revision) runtimeFail("CONFIG_EXPIRED");
      };
      const declarations = new Map(configuration.environmentVariables.map(item => [item.schemaName, item]));
      for (const [key, policy] of Object.entries(options.variables)) {
        const declaration = declarations.get(key);
        if (!declaration || (policy.allowEmpty !== undefined && declaration.type !== "text") ||
            (policy.validate !== undefined && declaration.type !== "json")) runtimeFail();
      }
      for (const declaration of configuration.environmentVariables) {
        if (declaration.type === "json" && !options.variables[declaration.schemaName]?.validate) runtimeFail();
      }
      const values: ResolvedConfiguration["values"] = {};
      for (const declaration of configuration.environmentVariables) {
        check();
        const policy = options.variables[declaration.schemaName];
        const common = { context: snapshot.context, cacheTtlMs: options.cacheTtlMs };
        let request: EnvironmentGetOptions;
        switch (declaration.type) {
          case "text": request = { ...common, type: "text", allowEmpty: policy?.allowEmpty ?? false }; break;
          case "number": request = { ...common, type: "number" }; break;
          case "boolean": request = { ...common, type: "boolean" }; break;
          case "json": request = {
            ...common, type: "json", validate: value => {
              check();
              const validate = policy?.validate;
              if (!validate) runtimeFail();
              try { runtimePredicate(validate, copyRuntimeJson(value)); }
              finally { check(); }
              return true;
            }
          }; break;
        }
        let resolved: ResolvedValue<unknown> | undefined;
        try {
          resolved = declaration.required
            ? await Environment.get(declaration.schemaName, request)
            : await Environment.getOptional(declaration.schemaName, { ...request, absence: "either" });
        } catch (cause) {
          check();
          throw cause;
        }
        check();
        values[declaration.schemaName] = resolved === undefined ? undefined
          : { ...resolved, value: copyRuntimeJson(resolved.value) };
      }
      check();
      return { name, revision, configuration, values };
    }
  };
}
