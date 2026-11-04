import { afterEach, describe, expect, it, vi } from "vitest";
import { preflight } from "../tools/preflight.js";
import { generateHandover } from "../tools/handover.js";
import { configuration, first, now, snapshot } from "./helpers.js";

afterEach(() => { vi.restoreAllMocks(); });

describe("read-only preflight", () => {
  it("does not turn source validation into deployment success", () => {
    const report = preflight(configuration(), { now });
    expect(report.readiness).toBe("incomplete");
    expect(report.evidenceScope).toBe("source");
    expect(report.summary.unknown).toBeGreaterThan(0);
    expect(report.summary.unsupported).toBe(0);
    expect(report.findings).toContainEqual(expect.objectContaining({ id: "REGISTRATION_UNVERIFIED" }));
  });

  it("uses only supplied type/presence evidence, not actual values or network calls", () => {
    const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("Network must not be used.");
    });
    const report = preflight(configuration(), { now, snapshot: snapshot() });
    expect(report.findings.filter((item) => item.id === "VARIABLE_PRESENCE_CONFIRMED")).toHaveLength(3);
    expect(report.readiness).toBe("incomplete");
    expect(report.evidenceScope).toBe("suppliedSnapshot");
    expect(network).not.toHaveBeenCalled();
  });

  it("accepts default presence without requiring current presence", () => {
    const evidence = snapshot();
    evidence.environmentVariables[0] = {
      schemaName: "vbd_TargetModelDrivenAppId", status: "available", type: "text",
      hasCurrentValue: false, hasDefaultValue: true
    };
    expect(preflight(configuration(), { now, snapshot: evidence }).findings)
      .toContainEqual(expect.objectContaining({ id: "VARIABLE_PRESENCE_CONFIRMED", path: "environmentVariables[0]" }));
  });

  it.each(["missing", "denied", "unknown", "unsupported"] as const)(
    "preserves incomplete/failed status for %s evidence", (status) => {
      const evidence = snapshot();
      evidence.environmentVariables[0] = { schemaName: "vbd_TargetModelDrivenAppId", status };
      const report = preflight(configuration(), { now, snapshot: evidence });
      expect(report.readiness).toBe(status === "missing" ? "failed" : "incomplete");
      expect(report.findings).toContainEqual(expect.objectContaining({
        path: "environmentVariables[0]",
        status: status === "missing" ? "fail" : status === "unsupported" ? "unsupported" : "unknown"
      }));
    }
  );

  it("fails required absence and warns for optional absence", () => {
    const evidence = snapshot();
    evidence.environmentVariables[0] = {
      schemaName: "vbd_TargetModelDrivenAppId", status: "available", type: "text",
      hasCurrentValue: false, hasDefaultValue: false
    };
    expect(preflight(configuration(), { now, snapshot: evidence }).readiness).toBe("failed");
    const input = configuration();
    input.environmentVariables.push({ schemaName: "vbd_Optional", type: "boolean", required: false });
    evidence.environmentVariables.push({ schemaName: "vbd_Optional", status: "missing" });
    expect(preflight(input, { now, snapshot: evidence }).findings).toContainEqual(
      expect.objectContaining({ id: "VARIABLE_DEFINITION_ABSENT", status: "warning" })
    );
  });

  it.each(["boolean", "secret", "dataSource"] as const)("fails a mismatched definition type: %s", (type) => {
    const evidence = snapshot();
    evidence.environmentVariables[0] = {
      schemaName: "vbd_TargetModelDrivenAppId", status: "available", type,
      hasCurrentValue: true, hasDefaultValue: false
    };
    const report = preflight(configuration(), { now, snapshot: evidence });
    expect(report.readiness).toBe("failed");
    expect(report.findings).toContainEqual(expect.objectContaining({ id: "VARIABLE_TYPE_MISMATCH" }));
  });

  it.each([-86_400_001, 300_001])("rejects evidence outside freshness bounds: %s milliseconds", (delta) => {
    const evidence = snapshot();
    evidence.observedAt = new Date(now.getTime() + delta).toISOString();
    const report = preflight(configuration(), { now, snapshot: evidence });
    expect(report.findings).toContainEqual(expect.objectContaining({ id: "SNAPSHOT_STALE", status: "unknown" }));
    expect(report.findings.filter((item) => item.id === "VARIABLE_PRESENCE_CONFIRMED")).toHaveLength(0);
  });

  it.each([-86_400_000, 300_000])("accepts the exact freshness bound: %s milliseconds", (delta) => {
    const evidence = snapshot();
    evidence.observedAt = new Date(now.getTime() + delta).toISOString();
    expect(preflight(configuration(), { now, snapshot: evidence }).findings)
      .toContainEqual(expect.objectContaining({ id: "SNAPSHOT_FRESH", status: "pass" }));
  });

  it("rejects raw values, duplicate names, and over-limit snapshots without echoing payloads", () => {
    const evidence = snapshot();
    const raw = {
      ...evidence,
      environmentVariables: [{ ...first(evidence.environmentVariables), value: "SNAPSHOT_SECRET_CANARY" }]
    };
    const report = preflight(configuration(), { now, snapshot: raw });
    expect(report.readiness).toBe("failed");
    expect(JSON.stringify(report)).not.toContain("SNAPSHOT_SECRET_CANARY");
    evidence.environmentVariables.push(first(evidence.environmentVariables));
    expect(preflight(configuration(), { now, snapshot: evidence }).readiness).toBe("failed");
    evidence.environmentVariables = Array.from({ length: 201 }, (_, index) => ({
      schemaName: `vbd_Field${index}`, status: "missing"
    }));
    expect(preflight(configuration(), { now, snapshot: evidence }).readiness).toBe("failed");
  });

  it("accepts 200 snapshot entries", () => {
    const evidence = snapshot();
    for (let index = evidence.environmentVariables.length; index < 200; index++) {
      evidence.environmentVariables.push({ schemaName: `vbd_Extra${index}`, status: "missing" });
    }
    expect(preflight(configuration(), { now, snapshot: evidence }).readiness).toBe("incomplete");
  });

  it("fails invalid source without retaining unknown payloads", () => {
    const report = preflight({ schemaVersion: 99, secret: "SOURCE_SECRET_CANARY" }, { now });
    expect(report.readiness).toBe("failed");
    expect(report.configurationId).toBeNull();
    expect(JSON.stringify(report)).not.toContain("SOURCE_SECRET_CANARY");
  });

  it("rejects invalid time and revision metadata", () => {
    expect(() => preflight(configuration(), { now: new Date("invalid") })).toThrow(/argument/);
    expect(() => preflight(configuration(), { sourceRevision: "not-a-git-sha" })).toThrow(/argument/);
  });
});

describe("handover", () => {
  it("generates deterministic Markdown and labels registration/runtime limits honestly", () => {
    const options = { now, snapshot: snapshot(), sourceRevision: "abcdef1234" };
    const firstReport = generateHandover(configuration(), options);
    expect(generateHandover(configuration(), options)).toEqual(firstReport);
    expect(firstReport.markdown).toContain("Declared only; not deployed/verified");
    expect(firstReport.markdown).toContain("command entry points are implemented");
    expect(firstReport.markdown).toContain("**incomplete**");
    expect(firstReport.markdown).toContain("abcdef1234");
    expect(firstReport.markdown).toContain("not a dependency");
    expect(firstReport.markdown).not.toContain("https://");
  });

  it("renders grid templates separately and never claims the adapter exists", () => {
    const input = configuration();
    first(input.registrations).surface = "gridCommand";
    const { markdown } = generateHandover(input, { now });
    expect(markdown).toContain("VBD.Commands.runGrid");
    expect(markdown).toContain("SelectedControl, selected references");
    expect(markdown).toContain("Deployed wiring was not inspected");
  });

  it("refuses invalid source and does not embed rejected snapshot values", () => {
    expect(() => generateHandover({ secret: "CANARY" }, { now })).toThrow(/invalid/);
    const result = generateHandover(configuration(), {
      now, snapshot: { ...snapshot(), token: "HANDOVER_SECRET_CANARY" }
    });
    expect(result.report.readiness).toBe("failed");
    expect(result.markdown).not.toContain("HANDOVER_SECRET_CANARY");
  });
});
