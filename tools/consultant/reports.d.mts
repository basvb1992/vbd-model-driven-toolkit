export type Status = "pass" | "warning" | "fail" | "unknown" | "unsupported";
export interface ConsultantReport {
  schemaVersion: 1;
  capabilityId: "C05" | "C08";
  toolkitVersion: string;
  generatedAt: string;
  scope: "suppliedSnapshotComparison" | "declaredUpgradeImpact";
  redaction: string;
  limitations: string[];
  sources: {
    id: string;
    kind: string;
    sha256: string;
    identity?: string;
    targetAlias?: string;
    observedAt?: string;
    sourceRevision?: string;
    installedVersion?: string;
    targetVersion?: string;
  }[];
  findings: {
    id: string;
    capabilityId: "C05" | "C08";
    status: Status;
    subject: string;
    message: string;
    remediation: string;
    evidence: { source: string; path: string }[];
    details: Record<string, string | boolean | Record<string, string | boolean>>;
  }[];
  summary: Record<Status, number>;
  readiness: "passed" | "failed" | "incomplete";
}
export function compareSnapshots(left: unknown, right: unknown, policy: unknown, options: { now: string }): ConsultantReport;
export function upgradeImpact(inventory: unknown, manifest: unknown, options: { now: string }): ConsultantReport;
export function exitCode(report: ConsultantReport): 0 | 1 | 2;
export function renderMarkdown(report: ConsultantReport): string;
