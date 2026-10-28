import { z } from "zod";
import { VbdError } from "./errors.js";
import { safePath } from "./findings.js";
import type { Finding } from "./findings.js";

const identifier = z.string().regex(/^[A-Za-z][A-Za-z0-9._-]{0,127}$/);
const schemaName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,127}$/);
const binding = z.object({ environmentVariable: schemaName }).strict();
const variable = z.object({
  schemaName,
  type: z.enum(["text", "number", "boolean", "json"]),
  required: z.boolean()
}).strict();
const profile = z.object({
  key: identifier,
  destinationKind: z.literal("modelDrivenApp"),
  appId: binding,
  environmentUrl: binding.optional(),
  presentation: z.literal("newWindow"),
  allowedOrigins: z.array(binding).min(1).max(20)
}).strict();
const registration = z.object({
  id: identifier,
  surface: z.enum(["formCommand", "gridCommand"]),
  profileKey: identifier
}).strict();

const configurationSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  environmentVariables: z.array(variable).min(1).max(200),
  launchProfiles: z.array(profile).min(1).max(100),
  registrations: z.array(registration).max(500)
}).strict().superRefine((config, ctx) => {
  const checkDuplicates = (values: string[], path: string, field: string): void => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      const key = value.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: "Duplicate identity. Use a unique name, including letter case.",
          path: [path, index, field]
        });
      }
      seen.add(key);
    });
  };
  checkDuplicates(config.environmentVariables.map((item) => item.schemaName), "environmentVariables", "schemaName");
  checkDuplicates(config.launchProfiles.map((item) => item.key), "launchProfiles", "key");
  checkDuplicates(config.registrations.map((item) => item.id), "registrations", "id");
  const variables = new Map(config.environmentVariables.map((item) => [item.schemaName, item]));
  config.launchProfiles.forEach((item, index) => {
    const references = [
      { value: item.appId, path: ["launchProfiles", index, "appId"] },
      ...item.allowedOrigins.map((value, originIndex) => ({
        value,
        path: ["launchProfiles", index, "allowedOrigins", originIndex]
      })),
      ...(item.environmentUrl ? [{
        value: item.environmentUrl,
        path: ["launchProfiles", index, "environmentUrl"]
      }] : [])
    ];
    for (const reference of references) {
      const declaration = variables.get(reference.value.environmentVariable);
      if (!declaration) {
        ctx.addIssue({
          code: "custom",
          message: "Binding references an undeclared environment variable. Declare its exact schema name.",
          path: [...reference.path, "environmentVariable"]
        });
      } else if (declaration.type !== "text" || !declaration.required) {
        ctx.addIssue({
          code: "custom",
          message: "Launch bindings require a required text environment-variable declaration.",
          path: [...reference.path, "environmentVariable"]
        });
      }
    }
  });
  const profiles = new Set(config.launchProfiles.map((item) => item.key));
  config.registrations.forEach((item, index) => {
    if (!profiles.has(item.profileKey)) {
      ctx.addIssue({
        code: "custom",
        message: "Registration references an undeclared profile. Use its exact key.",
        path: ["registrations", index, "profileKey"]
      });
    }
  });
});

export type ToolkitConfiguration = z.infer<typeof configurationSchema>;
export type EnvironmentRequirement = ToolkitConfiguration["environmentVariables"][number];
export type ConfigurationValidation =
  | { valid: true; configuration: ToolkitConfiguration; findings: Finding[] }
  | { valid: false; findings: Finding[] };

function validate(input: unknown): ConfigurationValidation {
  const result = configurationSchema.safeParse(input);
  if (!result.success) {
    return {
      valid: false,
      findings: result.error.issues.map((issue) => ({
        id: `CONFIG_${issue.code.toUpperCase()}`,
        capabilityId: "C01",
        status: "fail",
        path: safePath(issue.path),
        message: issue.code === "custom"
          ? issue.message
          : "Invalid configuration shape, type, value, or bound. Input values are withheld.",
        remediation: "Use schema version 1 and the documented declaration-only fields and limits.",
        evidence: "source"
      }))
    };
  }
  return {
    valid: true,
    configuration: result.data,
    findings: [{
      id: "CONFIG_VALID",
      capabilityId: "C01",
      status: "pass",
      path: "$",
      message: "Source configuration conforms to schema version 1.",
      remediation: "Resolve deployment checks separately; source validity does not prove deployment readiness.",
      evidence: "source"
    }]
  };
}

const registry = new Map<string, ToolkitConfiguration>();

function requireName(name: string): void {
  if (!identifier.safeParse(name).success) {
    throw new VbdError("INVALID_ARGUMENT", { operation: "config.registry" });
  }
}

function register(
  name: string,
  input: unknown,
  options: { replace?: boolean } = {}
): { name: string; schemaVersion: 1; replaced: boolean } {
  requireName(name);
  const parsedOptions = z.object({ replace: z.boolean().optional() }).strict().safeParse(options);
  if (!parsedOptions.success) {
    throw new VbdError("INVALID_ARGUMENT", { operation: "config.register" });
  }
  const result = validate(input);
  if (!result.valid) {
    throw new VbdError("CONFIG_INVALID", { operation: "config.register" });
  }
  const replaced = registry.has(name);
  if (replaced && parsedOptions.data.replace !== true) {
    throw new VbdError("CONFIG_ALREADY_REGISTERED", { operation: "config.register" });
  }
  registry.set(name, result.configuration);
  return { name, schemaVersion: 1, replaced };
}

function get(name: string): ToolkitConfiguration {
  requireName(name);
  const value = registry.get(name);
  if (!value) {
    throw new VbdError("CONFIG_NOT_FOUND", { operation: "config.get" });
  }
  return configurationSchema.parse(value);
}

export const Config = Object.freeze({ validate, register, get });
