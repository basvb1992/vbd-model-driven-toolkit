import { afterEach, describe, expect, it, vi } from "vitest";
import { compareSnapshots, exitCode, renderMarkdown } from "../../tools/consultant/reports.mjs";
import { at, available, expectDifference, now, options, policy, snapshot } from "./fixtures.js";

afterEach(() => { vi.restoreAllMocks(); });

describe("C05 sanitized comparison", () => {
  it("compares type/presence, with aliases/times as provenance, not drift", () => {
    const right = snapshot();
    right.targetAlias = "target.example";
    right.observedAt = "2026-10-28T09:30:00Z";
    const left = snapshot();
    left.environmentVariables[0] = available("VBD_EXAMPLESETTING");
    const report = compareSnapshots(left, right, policy(), options);
    expect(report.readiness).toBe("passed");
    expect(exitCode(report)).toBe(0);
    expect(report.findings).toContainEqual(expect.objectContaining({ id: "VARIABLE_MATCH", subject: "vbd_examplesetting" }));
    expect(report.sources).toContainEqual(expect.objectContaining({
      id: "right", targetAlias: "target.example", observedAt: right.observedAt
    }));
    expect(report.sources.every((item) => /^[a-f0-9]{64}$/.test(item.sha256))).toBe(true);
    expect(compareSnapshots(left, right, policy(), options)).toEqual(report);
    expect(renderMarkdown(report)).toContain("No actual values, URLs or records");
    expect(renderMarkdown(report)).toContain("right:environmentVariables[0]");
  });

  it.each(["currentPresence", "defaultPresence", "definition"] as const)(
    "requires an exact directional policy for %s differences", (facet) => {
      const left = snapshot();
      const right = snapshot();
      left.environmentVariables[0] = {
        schemaName: "vbd_ExampleSetting", status: "available", type: "text",
        hasCurrentValue: true, hasDefaultValue: true
      };
      right.environmentVariables[0] = facet === "definition"
        ? { schemaName: "vbd_ExampleSetting", status: "missing" }
        : {
          schemaName: "vbd_ExampleSetting", status: "available", type: "text",
          hasCurrentValue: facet !== "currentPresence", hasDefaultValue: facet !== "defaultPresence"
        };
      expect(compareSnapshots(left, right, policy(), options).readiness).toBe("failed");
      const expected = compareSnapshots(left, right, expectDifference(facet), options);
      expect(expected.readiness).toBe("passed");
      expect(expected.findings).toContainEqual(expect.objectContaining({
        id: "EXPECTED_DIFFERENCE", status: "pass",
        evidence: expect.arrayContaining([{ source: "policy", path: "expectedDifferences[0]" }])
      }));
      expect(compareSnapshots(right, left, expectDifference(facet), options).readiness).toBe("failed");
    }
  );

  it("preserves type failure even when a presence difference is expected", () => {
    const right = snapshot();
    right.environmentVariables[0] = {
      schemaName: "vbd_ExampleSetting", status: "available", type: "number",
      hasCurrentValue: false, hasDefaultValue: false
    };
    const report = compareSnapshots(snapshot(), right, expectDifference("currentPresence"), options);
    expect(report.readiness).toBe("failed");
    expect(report.findings).toContainEqual(expect.objectContaining({ id: "VARIABLE_TYPE_CHANGED", status: "fail" }));
  });

  it.each(["secret", "dataSource"] as const)("never waives protected type %s", (type) => {
    const left = snapshot();
    const right = snapshot();
    left.environmentVariables[0] = available("vbd_ExampleSetting", type);
    right.environmentVariables[0] = { schemaName: "vbd_ExampleSetting", status: "missing" };
    const report = compareSnapshots(left, right, expectDifference("definition"), options);
    expect(report.readiness).toBe("incomplete");
    expect(report.summary.unsupported).toBe(1);
    expect(report.findings.some((item) => item.id === "EXPECTED_DIFFERENCE")).toBe(false);
  });

  it("reports known type drift as well as protected-type uncertainty", () => {
    const right = snapshot();
    right.environmentVariables[0] = available("vbd_ExampleSetting", "secret");
    const report = compareSnapshots(snapshot(), right, policy(), options);
    expect(report.readiness).toBe("failed");
    expect(report.findings).toContainEqual(expect.objectContaining({ id: "VARIABLE_TYPE_CHANGED", status: "fail" }));
    expect(report.findings).toContainEqual(expect.objectContaining({ id: "VARIABLE_PROTECTED_TYPE", status: "unsupported" }));
  });

  it.each(["denied", "unknown", "unsupported"] as const)("does not compare inaccessible %s evidence", (status) => {
    const right = snapshot();
    right.environmentVariables[0] = { schemaName: "vbd_ExampleSetting", status };
    const report = compareSnapshots(snapshot(), right, expectDifference("definition"), options);
    expect(report.readiness).toBe("incomplete");
    expect(exitCode(report)).toBe(2);
    expect(report.findings.filter((item) => item.subject.startsWith("vbd_") && item.status === "pass")).toHaveLength(0);
    expect(report.findings).toContainEqual(expect.objectContaining({
      id: "VARIABLE_ACCESS_UNVERIFIED", status: status === "unsupported" ? "unsupported" : "unknown"
    }));
  });

  it("treats omitted observations as unknown, not observed missing definitions", () => {
    const right = snapshot();
    right.environmentVariables = [];
    expect(compareSnapshots(snapshot(), right, expectDifference("definition"), options).readiness).toBe("incomplete");
    const left = snapshot();
    left.environmentVariables = [];
    expect(compareSnapshots(left, right, policy(), options).readiness).toBe("incomplete");
    left.environmentVariables = [{ schemaName: "vbd_ExampleSetting", status: "missing" }];
    right.environmentVariables = [...left.environmentVariables];
    expect(compareSnapshots(left, right, policy(), options).findings)
      .toContainEqual(expect.objectContaining({ id: "VARIABLE_BOTH_MISSING", status: "warning" }));
  });

  it("reports unused policy as incomplete instead of silently ignoring it", () => {
    const report = compareSnapshots(snapshot(), snapshot(), expectDifference("definition"), options);
    expect(report.readiness).toBe("incomplete");
    expect(report.findings).toContainEqual(expect.objectContaining({ id: "POLICY_NOT_ESTABLISHED" }));
  });

  it.each([-86_400_001, 300_001])("never passes stale/future variable evidence at %i ms", (delta) => {
    const right = snapshot();
    right.observedAt = new Date(Date.parse(now) + delta).toISOString();
    const report = compareSnapshots(snapshot(), right, policy(), options);
    expect(report.readiness).toBe("incomplete");
    expect(report.findings).toContainEqual(expect.objectContaining({ id: "VARIABLE_STALE", status: "unknown" }));
    expect(report.findings.some((item) => item.id === "VARIABLE_MATCH")).toBe(false);
  });

  it.each([-86_400_000, 300_000])("accepts inclusive freshness limit %i ms", (delta) => {
    const right = snapshot();
    right.observedAt = new Date(Date.parse(now) + delta).toISOString();
    expect(compareSnapshots(snapshot(), right, policy(), options).readiness).toBe("passed");
  });

  it("uses no network and leaves all inputs unchanged", () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network."));
    const left = snapshot();
    const before = JSON.stringify(left);
    compareSnapshots(left, snapshot(), policy(), options);
    expect(JSON.stringify(left)).toBe(before);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("C05 strict schema/redaction", () => {
  it.each([
    { ...snapshot(), schemaVersion: 2 },
    { ...snapshot(), rawValue: "VALUE_CANARY" },
    { ...snapshot(), targetAlias: "https://example.example/?VALUE_CANARY" },
    { ...snapshot(), observedAt: "invalid" },
    { ...snapshot(), environmentVariables: [{ ...available(), value: "VALUE_CANARY" }] },
    { ...snapshot(), environmentVariables: [{ schemaName: "vbd_ExampleSetting", status: "denied", type: "text" }] },
    { ...snapshot(), environmentVariables: [available(), available("VBD_EXAMPLESETTING")] },
    { ...snapshot(), environmentVariables: [available(`v${"x".repeat(128)}`)] },
    { ...snapshot(), environmentVariables: Array.from({ length: 201 }, (_, i) => available(`vbd_Example${i}`)) }
  ])("rejects malformed or value-bearing snapshots without echoing input %#", (input) => {
    try {
      compareSnapshots(input, snapshot(), policy(), options);
      expect.fail("Invalid input accepted.");
    } catch (error) {
      // Built and source VbdError are different class identities; the safe contract is the code/message.
      expect(error).toMatchObject({ name: "VbdError", code: "INVALID_ARGUMENT", cause: undefined });
      expect(String(error)).not.toContain("VALUE_CANARY");
    }
  });

  it("accepts all 200 bounded declarations and 128 character identities", () => {
    const left = snapshot();
    left.targetAlias = `a${"x".repeat(127)}`;
    left.environmentVariables = Array.from({ length: 200 }, (_, i) => available(`vbd_Example${i}`));
    left.environmentVariables[0] = available(`v${"x".repeat(127)}`);
    expect(compareSnapshots(left, left, policy(), options).readiness).toBe("passed");
  });

  it("accepts exactly 200 policy rules and bounds policy identities", () => {
    const left = snapshot();
    const right = snapshot();
    left.environmentVariables = Array.from({ length: 200 }, (_, i) => available(`vbd_Example${i}`));
    right.environmentVariables = left.environmentVariables.map((item) => ({
      schemaName: item.schemaName, status: "missing"
    }));
    const expected = policy();
    expected.policyId = `p${"x".repeat(127)}`;
    expected.expectedDifferences = left.environmentVariables.map((item) => ({
      schemaName: item.schemaName, facet: "definition", left: true, right: false, reason: "optionalDefinition"
    }));
    expect(compareSnapshots(left, right, expected, options).readiness).toBe("passed");
    expected.policyId += "x";
    expect(() => compareSnapshots(left, right, expected, options)).toThrow(/argument/);
  });

  it.each([
    { ...policy(), schemaVersion: 9 },
    { ...policy(), allowTypes: true },
    { ...policy(), expectedDifferences: [{ ...at(expectDifference("definition").expectedDifferences), facet: "type" }] },
    { ...policy(), expectedDifferences: [{ ...at(expectDifference("definition").expectedDifferences), left: false }] },
    { ...policy(), expectedDifferences: [...expectDifference("definition").expectedDifferences, ...expectDifference("definition").expectedDifferences] },
    { ...policy(), expectedDifferences: Array.from({ length: 201 }, (_, i) => ({
      ...at(expectDifference("definition").expectedDifferences), schemaName: `vbd_Example${i}`
    })) }
  ])("rejects unknown, ambiguous, unbounded and security/type waiver policy %#", (input) => {
    expect(() => compareSnapshots(snapshot(), snapshot(), input, options)).toThrow(/argument/);
  });

  it("rejects invalid selected observation times and extra options", () => {
    expect(() => compareSnapshots(snapshot(), snapshot(), policy(), { now: "invalid" })).toThrow(/argument/);
    const extraOptions = { ...options, value: "VALUE_CANARY" };
    expect(() => compareSnapshots(snapshot(), snapshot(), policy(), extraOptions)).toThrow();
  });
});
