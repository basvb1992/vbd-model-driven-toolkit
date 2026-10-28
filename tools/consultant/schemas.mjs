import { z } from "zod";
import { VbdError } from "../../dist/index.mjs";

const name = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,127}$/);
const identifier = z.string().regex(/^[A-Za-z][A-Za-z0-9._-]{0,127}$/);
const functionName = z.string().max(128).regex(/^VBD\.[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$/);
// Deliberately bounded release labels, not a semver compatibility algorithm.
const version = z.string().max(14).regex(/^(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})$/);
export const time = z.iso.datetime({ offset: true }).max(35);
export const optionsSchema = z.object({ now: time }).strict();
const variable = z.discriminatedUnion("status", [
  z.object({
    schemaName: name, status: z.literal("available"),
    type: z.enum(["text", "number", "boolean", "json", "secret", "dataSource"]),
    hasCurrentValue: z.boolean(), hasDefaultValue: z.boolean()
  }).strict(),
  ...["missing", "denied", "unknown", "unsupported"].map((status) =>
    z.object({ schemaName: name, status: z.literal(status) }).strict())
]);

function unique(items, key, ctx) {
  const keys = items.map((item) => key(item).toLowerCase());
  if (new Set(keys).size !== keys.length) {
    ctx.addIssue({ code: "custom", message: "Duplicate identity." });
  }
}

export const snapshotSchema = z.object({
  schemaVersion: z.literal(1), targetAlias: identifier, observedAt: time,
  environmentVariables: z.array(variable).max(200)
}).strict().superRefine((data, ctx) => unique(data.environmentVariables, (item) => item.schemaName, ctx));

export const policySchema = z.object({
  schemaVersion: z.literal(1), policyId: identifier,
  expectedDifferences: z.array(z.object({
    schemaName: name, facet: z.enum(["definition", "currentPresence", "defaultPresence"]),
    left: z.boolean(), right: z.boolean(),
    reason: z.enum(["environmentSpecific", "optionalDefinition"])
  }).strict().refine((rule) => rule.left !== rule.right)).max(200)
}).strict().superRefine((data, ctx) =>
  unique(data.expectedDifferences, (item) => `${item.schemaName}.${item.facet}`, ctx));

const compatibilityStatus = z.enum(["supported", "deprecated", "removed", "unsupported"]);
const api = z.object({
  name: functionName, status: compatibilityStatus, replacement: functionName.optional()
}).strict();
const contract = z.object({
  key: identifier, status: compatibilityStatus, replacement: identifier.optional()
}).strict();

export const manifestSchema = z.object({
  schemaVersion: z.literal(1), manifestId: identifier, observedAt: time,
  versions: z.array(z.object({
    version, status: z.enum(["supported", "unsupported"]),
    functions: z.array(api).max(200), configurations: z.array(contract).max(100)
  }).strict()).min(1).max(16)
}).strict().superRefine((data, ctx) => {
  unique(data.versions, (item) => item.version, ctx);
  for (const release of data.versions) {
    unique(release.functions, (item) => item.name, ctx);
    unique(release.configurations, (item) => item.key, ctx);
    for (const entries of [release.functions, release.configurations]) {
      for (const item of entries) {
        if (item.replacement !== undefined) {
          const target = entries.find((candidate) => (candidate.name ?? candidate.key) === item.replacement);
          if (!["deprecated", "removed"].includes(item.status) ||
              !target || target === item || target.status !== "supported") {
            ctx.addIssue({ code: "custom", message: "Invalid replacement reference." });
          }
        }
      }
    }
  }
});

const registrationFields = {
  id: identifier, functionRef: identifier, configurationRef: identifier.optional()
};
export const inventorySchema = z.object({
  schemaVersion: z.literal(1), inventoryId: identifier,
  sourceRevision: z.string().regex(/^[a-f0-9]{7,40}$/i),
  observedAt: time, installedVersion: version, targetVersion: version,
  registrationCoverage: z.enum(["complete", "incomplete", "unknown"]),
  functions: z.array(z.object({ id: identifier, name: functionName }).strict()).min(1).max(200),
  configurations: z.array(z.object({ id: identifier, contract: identifier }).strict()).max(100),
  registrations: z.array(z.discriminatedUnion("evidence", [
    z.object({ ...registrationFields, evidence: z.literal("observed"), observedAt: time }).strict(),
    ...["declared", "denied", "unknown", "unsupported"].map((evidence) =>
      z.object({ ...registrationFields, evidence: z.literal(evidence) }).strict())
  ])).max(500)
}).strict().superRefine((data, ctx) => {
  for (const entries of [data.functions, data.configurations, data.registrations]) {
    unique(entries, (item) => item.id, ctx);
  }
  for (const registration of data.registrations) {
    if (!data.functions.some((item) => item.id === registration.functionRef) ||
        (registration.configurationRef !== undefined &&
         !data.configurations.some((item) => item.id === registration.configurationRef))) {
      ctx.addIssue({ code: "custom", message: "Invalid inventory reference." });
    }
  }
});

export function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    // Never retain Zod issues, unknown property names, or raw input as a cause.
    throw new VbdError("INVALID_ARGUMENT", { operation: "consultant.validate" });
  }
  return result.data;
}
