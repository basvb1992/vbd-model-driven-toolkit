export const now = "2026-10-28T10:00:00.000Z";
export const options = { now };
type VariableType = "text" | "number" | "boolean" | "json" | "secret" | "dataSource";
export type Variable = {
  schemaName: string;
  status: "available";
  type: VariableType;
  hasCurrentValue: boolean;
  hasDefaultValue: boolean;
} | { schemaName: string; status: "missing" | "denied" | "unknown" | "unsupported" };
export function available(schemaName = "vbd_ExampleSetting", type: VariableType = "text"): Variable {
  return { schemaName, status: "available", type, hasCurrentValue: true, hasDefaultValue: false };
}
export function snapshot() {
  return {
    schemaVersion: 1, targetAlias: "source.example", observedAt: now,
    environmentVariables: [available()]
  };
}
export interface Policy {
  schemaVersion: 1;
  policyId: string;
  expectedDifferences: {
    schemaName: string;
    facet: "definition" | "currentPresence" | "defaultPresence";
    left: boolean;
    right: boolean;
    reason: "environmentSpecific" | "optionalDefinition";
  }[];
}
export function policy(): Policy {
  return { schemaVersion: 1, policyId: "examplePolicy", expectedDifferences: [] };
}
export function expectDifference(facet: "definition" | "currentPresence" | "defaultPresence"): Policy {
  return {
    ...policy(), expectedDifferences: [{
      schemaName: "vbd_ExampleSetting", facet, left: true, right: false, reason: "environmentSpecific"
    }]
  };
}
type Compatibility = "supported" | "deprecated" | "removed" | "unsupported";
interface Release {
  version: string;
  status: "supported" | "unsupported";
  functions: { name: string; status: Compatibility; replacement?: string }[];
  configurations: { key: string; status: Compatibility; replacement?: string }[];
}
export function manifest(): {
  schemaVersion: 1; manifestId: string; observedAt: string; versions: Release[];
} {
  const release = (version: string): Release => ({
    version, status: "supported",
    functions: [{ name: "VBD.Config.validate", status: "supported" }],
    configurations: [{ key: "toolkitConfiguration.v1", status: "supported" }]
  });
  return {
    schemaVersion: 1, manifestId: "syntheticCompatibility", observedAt: now,
    versions: [release("0.2.0"), release("0.3.0")]
  };
}
type Registration = {
  id: string; functionRef: string; configurationRef?: string;
} & ({ evidence: "observed"; observedAt: string } |
  { evidence: "declared" | "denied" | "unknown" | "unsupported" });
export function inventory(): {
  schemaVersion: 1; inventoryId: string; sourceRevision: string; observedAt: string;
  installedVersion: string; targetVersion: string;
  registrationCoverage: "complete" | "incomplete" | "unknown";
  functions: { id: string; name: string }[];
  configurations: { id: string; contract: string }[];
  registrations: Registration[];
} {
  return {
    schemaVersion: 1, inventoryId: "exampleInventory", sourceRevision: "a679b55",
    observedAt: now, installedVersion: "0.2.0", targetVersion: "0.3.0",
    registrationCoverage: "complete",
    functions: [{ id: "validateExample", name: "VBD.Config.validate" }],
    configurations: [{ id: "configExample", contract: "toolkitConfiguration.v1" }],
    registrations: [{
      id: "registrationExample", functionRef: "validateExample", configurationRef: "configExample",
      evidence: "observed", observedAt: now
    }]
  };
}
export function at<T>(items: T[], index = 0): T {
  const item = items[index];
  if (item === undefined) throw new Error("Missing synthetic fixture.");
  return item;
}
