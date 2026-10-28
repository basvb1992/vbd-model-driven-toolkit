export type FindingStatus = "pass" | "warning" | "fail" | "unknown" | "unsupported";

export interface Finding {
  id: string;
  capabilityId: "C01" | "C02" | "C03";
  status: FindingStatus;
  path: string;
  message: string;
  remediation: string;
  evidence: "source" | "snapshot" | "unverified";
}

const safeSegments = new Set([
  "schemaVersion", "id", "environmentVariables", "schemaName", "type", "required",
  "launchProfiles", "key", "destinationKind", "appId", "environmentUrl",
  "environmentVariable", "presentation", "allowedOrigins", "registrations",
  "surface", "profileKey", "targetAlias", "observedAt", "status",
  "hasCurrentValue", "hasDefaultValue"
]);

export function safePath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((result, segment) => {
    if (typeof segment === "number") {
      return `${result}[${segment}]`;
    }
    const key = typeof segment === "string" && safeSegments.has(segment)
      ? segment
      : "redacted";
    return result ? `${result}.${key}` : key;
  }, "") || "$";
}
