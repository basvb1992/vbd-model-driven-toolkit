import { vi } from "vitest";
import type { ReadContext, ReadScope } from "../src/index.js";

export interface VariableFixture {
  type: number;
  current?: string | null;
  defaultValue?: string | null;
}

export function readFixture(variables: Record<string, VariableFixture>) {
  const scope: ReadScope = {
    environmentUrl: "https://source.example",
    userId: crypto.randomUUID(),
    languageId: 1033,
    online: true
  };
  const entries = new Map(Object.entries(variables).map(([name, value]) => [
    name, { id: crypto.randomUUID(), ...value }
  ]));
  let active = 0;
  let maximumActive = 0;
  const retrieve = vi.fn(async (table: string, query: string, maximumPageSize: number): Promise<unknown> => {
    if (maximumPageSize !== 2 || !query.endsWith("&$top=2")) {
      throw new Error("Fixture requires bounded supported queries.");
    }
    active++;
    maximumActive = Math.max(maximumActive, active);
    await Promise.resolve();
    try {
      if (table === "environmentvariabledefinition" && query.includes("schemaname eq")) {
        const name = query.match(/schemaname eq '([^']+)'/)?.[1];
        const value = name ? entries.get(name) : undefined;
        return { entities: value ? [{
          environmentvariabledefinitionid: value.id, schemaname: name, type: value.type
        }] : [] };
      }
      const id = query.match(/(?:definitionid_value|definitionid) eq ([a-f0-9-]+)/)?.[1];
      const value = [...entries.values()].find((entry) => entry.id === id);
      if (!value) {
        throw new Error("Unexpected fixture identity.");
      }
      if (table === "environmentvariablevalue") {
        return { entities: value.current === undefined ? [] : [{ value: value.current }] };
      }
      if (table === "environmentvariabledefinition" && query.includes("$select=defaultvalue,type")) {
        return { entities: [{ type: value.type, defaultvalue: value.defaultValue ?? null }] };
      }
      throw new Error("Unexpected fixture query.");
    } finally {
      active--;
    }
  });
  const context: ReadContext = {
    getScope: () => ({ ...scope }),
    retrieveMultipleRecords: retrieve
  };
  function variable(name: string) {
    const value = entries.get(name);
    if (!value) {
      throw new Error("Fixture variable does not exist.");
    }
    return value;
  }
  return { context, scope, retrieve, variable, maximumActive: () => maximumActive };
}

export function deferred() {
  let release = (): void => { throw new Error("Deferred is not initialized."); };
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

export const appId = "11111111-2222-3333-4444-555555555555";

export function launchFixture() {
  return readFixture({
    vbd_TargetModelDrivenAppId: { type: 100000000, current: appId },
    vbd_TargetEnvironmentUrl: { type: 100000000, current: "https://target.example" },
    vbd_ApprovedAppOrigin: { type: 100000000, current: "https://target.example" }
  });
}
