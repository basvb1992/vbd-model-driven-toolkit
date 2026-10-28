import example from "../examples/customer-workspace.json" with { type: "json" };
import type { SanitizedSnapshot } from "../tools/preflight.js";

export const now = new Date("2026-10-28T09:00:00Z");

export function configuration(): typeof example {
  return structuredClone(example);
}

export function snapshot(): SanitizedSnapshot {
  return {
    schemaVersion: 1,
    targetAlias: "test",
    observedAt: now.toISOString(),
    environmentVariables: example.environmentVariables.map((item) => ({
      schemaName: item.schemaName,
      status: "available",
      type: "text",
      hasCurrentValue: true,
      hasDefaultValue: false
    }))
  };
}

export function first<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined) {
    throw new Error("Fixture requires a first item.");
  }
  return value;
}
