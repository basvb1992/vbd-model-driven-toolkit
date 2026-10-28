import { z } from "zod";
import { Config } from "../src/configuration.js";
import { Diagnostics } from "../src/diagnostics.js";
import { VbdError } from "../src/errors.js";
import type { Finding, FindingStatus } from "../src/findings.js";

const name = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,127}$/);
const unavailable = z.object({
  schemaName: name,
  status: z.enum(["missing", "denied", "unknown", "unsupported"])
}).strict();
const available = z.object({
  schemaName: name,
  status: z.literal("available"),
  type: z.enum(["text", "number", "boolean", "json", "secret", "dataSource"]),
  hasCurrentValue: z.boolean(),
  hasDefaultValue: z.boolean()
}).strict();
const snapshotSchema = z.object({
  schemaVersion: z.literal(1),
  targetAlias: z.string().regex(/^[A-Za-z][A-Za-z0-9._-]{0,127}$/),
  observedAt: z.iso.datetime({ offset: true }),
  environmentVariables: z.array(z.union([available, unavailable])).max(200)
}).strict().superRefine((snapshot, ctx) => {
  const seen = new Set<string>();
  snapshot.environmentVariables.forEach((item, index) => {
    const key = item.schemaName.toLowerCase();
    if (seen.has(key)) {
      ctx.addIssue({
        code: "custom",
        message: "Duplicate snapshot declaration.",
        path: ["environmentVariables", index]
      });
    }
    seen.add(key);
  });
});

export type SanitizedSnapshot = z.infer<typeof snapshotSchema>;
export interface PreflightOptions {
  snapshot?: unknown;
  now?: Date;
  sourceRevision?: string;
}
export interface PreflightReport {
  schemaVersion: 1;
  toolkitVersion: string;
  configurationId: string | null;
  generatedAt: string;
  sourceRevision: string | null;
  evidenceScope: "source" | "suppliedSnapshot";
  targetAlias: string | null;
  snapshotObservedAt: string | null;
  readiness: "passed" | "failed" | "incomplete";
  summary: Record<FindingStatus, number>;
  findings: Finding[];
}

export function preflight(input: unknown, options: PreflightOptions = {}): PreflightReport {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime()) ||
      (options.sourceRevision !== undefined && !/^[a-f0-9]{7,40}$/i.test(options.sourceRevision))) {
    throw new VbdError("INVALID_ARGUMENT", { operation: "preflight" });
  }
  const validation = Config.validate(input);
  const findings = [...validation.findings];
  let snapshot: SanitizedSnapshot | undefined;
  let fresh = false;
  if (options.snapshot !== undefined) {
    const parsed = snapshotSchema.safeParse(options.snapshot);
    if (!parsed.success) {
      findings.push({
        id: "SNAPSHOT_INVALID", capabilityId: "C02", status: "fail", path: "snapshot",
        message: "Snapshot shape, type, bounds, or identities are invalid. Input values are withheld.",
        remediation: "Use the documented sanitized snapshot schema; omit all actual values.",
        evidence: "source"
      });
    } else {
      snapshot = parsed.data;
      const age = now.getTime() - Date.parse(snapshot.observedAt);
      fresh = age >= -5 * 60_000 && age <= 24 * 60 * 60_000;
      findings.push({
        id: fresh ? "SNAPSHOT_FRESH" : "SNAPSHOT_STALE",
        capabilityId: "C02", status: fresh ? "pass" : "unknown", path: "snapshot",
        message: fresh
          ? "Supplied evidence is within the 24-hour age and 5-minute future-skew limits."
          : "Snapshot evidence is stale or exceeds permitted future clock skew.",
        remediation: "Collect fresh authorized evidence; supplied snapshots are not live verification.",
        evidence: "snapshot"
      });
    }
  }
  if (validation.valid) {
    validation.configuration.environmentVariables.forEach((requirement, index) => {
      const path = `environmentVariables[${index}]`;
      const evidence = fresh
        ? snapshot?.environmentVariables.find((item) => item.schemaName === requirement.schemaName)
        : undefined;
      let status: FindingStatus = "unknown";
      let id = "VARIABLE_UNVERIFIED";
      let message = "No fresh authorized evidence covers this variable declaration.";
      if (evidence?.status === "available") {
        if (evidence.type !== requirement.type) {
          status = "fail";
          id = "VARIABLE_TYPE_MISMATCH";
          message = "The supplied definition type does not match the declared browser-safe type.";
        } else if (!evidence.hasCurrentValue && !evidence.hasDefaultValue) {
          status = requirement.required ? "fail" : "warning";
          id = "VARIABLE_VALUE_ABSENT";
          message = "Evidence indicates neither a current value nor a default is configured.";
        } else {
          status = "pass";
          id = "VARIABLE_PRESENCE_CONFIRMED";
          message = "Supplied evidence indicates the expected definition type and a configured value.";
        }
      } else if (evidence?.status === "missing") {
        status = requirement.required ? "fail" : "warning";
        id = "VARIABLE_DEFINITION_ABSENT";
        message = "Supplied evidence indicates the variable definition is absent.";
      } else if (evidence?.status === "unsupported") {
        status = "unsupported";
        id = "VARIABLE_CHECK_UNSUPPORTED";
        message = "The supplied evidence marks this variable check as unsupported.";
      } else if (evidence?.status === "denied") {
        id = "VARIABLE_ACCESS_DENIED";
        message = "Read access was denied. Value presence and type are not verified.";
      }
      findings.push({
        id, capabilityId: "C02", status, path, message,
        remediation: "Verify definition, type, and value presence with authorized access; do not export actual values.",
        evidence: evidence ? "snapshot" : "unverified"
      });
    });
    validation.configuration.launchProfiles.forEach((_profile, index) => {
      findings.push({
        id: "LAUNCH_DESTINATION_UNVERIFIED", capabilityId: "C02", status: "unknown",
        path: `launchProfiles[${index}]`,
        message: "Launcher source is available, but destination values, origin policy, app access, and browser behavior were not checked.",
        remediation: "Prepare the profile in a supported authorized client and verify its destination and user-gesture behavior separately.",
        evidence: "unverified"
      });
    });
    validation.configuration.registrations.forEach((_registration, index) => {
      findings.push({
        id: "COMMAND_RUNTIME_UNAVAILABLE", capabilityId: "C02", status: "unsupported",
        path: `registrations[${index}]`,
        message: "Generic form/grid command adapters are not implemented.",
        remediation: "Use the typed launcher API only; do not register the planned generic command templates yet.",
        evidence: "source"
      });
      findings.push({
        id: "REGISTRATION_UNVERIFIED", capabilityId: "C02", status: "unknown",
        path: `registrations[${index}]`,
        message: "Registration is declared only. No deployed form or command was inspected.",
        remediation: "Verify actual registration and implemented entry points before deployment.",
        evidence: "unverified"
      });
    });
    findings.push({
      id: "LIVE_VERIFICATION_UNAVAILABLE", capabilityId: "C02", status: "unknown", path: "$",
      message: "Live app availability, access, URL values, and deployed registrations were not verified.",
      remediation: "Run future supported live checks and scoped model-driven smoke scenarios separately.",
      evidence: "unverified"
    });
  }
  const summary: Record<FindingStatus, number> = {
    pass: 0, warning: 0, fail: 0, unknown: 0, unsupported: 0
  };
  for (const finding of findings) {
    summary[finding.status] += 1;
  }
  return {
    schemaVersion: 1,
    toolkitVersion: Diagnostics.getVersion(),
    configurationId: validation.valid ? validation.configuration.id : null,
    generatedAt: now.toISOString(),
    sourceRevision: options.sourceRevision ?? null,
    evidenceScope: options.snapshot !== undefined ? "suppliedSnapshot" : "source",
    targetAlias: snapshot?.targetAlias ?? null,
    snapshotObservedAt: snapshot?.observedAt ?? null,
    readiness: summary.fail > 0 ? "failed"
      : summary.unknown > 0 || summary.unsupported > 0 ? "incomplete" : "passed",
    summary,
    findings
  };
}

export function exitCode(report: PreflightReport): 0 | 1 | 2 {
  return report.readiness === "failed" ? 1 : report.readiness === "incomplete" ? 2 : 0;
}
