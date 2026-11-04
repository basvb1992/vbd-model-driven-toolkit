import { describe, expect, it, vi } from "vitest";
import { exitCode, renderMarkdown, upgradeImpact } from "../../tools/consultant/reports.mjs";
import { at, inventory, manifest, now, options } from "./fixtures.js";

describe("C08 explicit compatibility evidence", () => {
  it("supports exact unchanged contracts, deterministic output and precise provenance", () => {
    const report = upgradeImpact(inventory(), manifest(), options);
    expect(report.readiness).toBe("passed");
    expect(exitCode(report)).toBe(0);
    expect(upgradeImpact(inventory(), manifest(), options)).toEqual(report);
    expect(report.sources).toContainEqual(expect.objectContaining({
      id: "inventory", kind: "source", sourceRevision: "a679b55", targetVersion: "0.3.0"
    }));
    expect(report.findings).toContainEqual(expect.objectContaining({
      id: "REFERENCE_SUPPORTED", subject: "targetVersion.functions.validateExample",
      evidence: expect.arrayContaining([{ source: "manifest", path: "versions[1].functions[0]" }])
    }));
    expect(renderMarkdown(report)).toContain("not independently inspected");
    expect(renderMarkdown(report)).not.toContain("https://");
  });

  it.each(["deprecated", "removed", "unsupported"] as const)("reports %s API and configuration contracts honestly", (status) => {
    const metadata = manifest();
    const target = at(metadata.versions, 1);
    at(target.functions).status = status;
    at(target.configurations).status = status;
    const report = upgradeImpact(inventory(), metadata, options);
    expect(report.readiness).toBe(status === "removed" ? "failed" : "incomplete");
    expect(report.findings.filter((item) => item.id === `REFERENCE_${status.toUpperCase()}`)).toHaveLength(2);
    expect(exitCode(report)).toBe(status === "removed" ? 1 : 2);
  });

  it("includes only explicit valid replacement references and manual remediation", () => {
    const metadata = manifest();
    const release = at(metadata.versions, 1);
    at(release.functions).status = "deprecated";
    at(release.functions).replacement = "VBD.Config.get";
    release.functions.push({ name: "VBD.Config.get", status: "supported" });
    at(release.configurations).status = "removed";
    at(release.configurations).replacement = "toolkitConfiguration.v2";
    release.configurations.push({ key: "toolkitConfiguration.v2", status: "supported" });
    const report = upgradeImpact(inventory(), metadata, options);
    expect(report.findings).toContainEqual(expect.objectContaining({
      id: "REFERENCE_DEPRECATED",
      details: expect.objectContaining({ replacement: "VBD.Config.get" }),
      remediation: expect.stringContaining("migrate manually")
    }));
    expect(report.readiness).toBe("failed");
  });

  it.each(["installedVersion", "targetVersion"] as const)("does not infer %s compatibility from semver", (field) => {
    const declared = inventory();
    declared[field] = "0.2.1";
    const report = upgradeImpact(declared, manifest(), options);
    expect(report.readiness).toBe("incomplete");
    expect(report.findings).toContainEqual(expect.objectContaining({ id: "VERSION_UNKNOWN", subject: field }));
  });

  it("reports explicitly unsupported release and unknown APIs/config contracts", () => {
    const metadata = manifest();
    at(metadata.versions, 1).status = "unsupported";
    expect(upgradeImpact(inventory(), metadata, options).findings)
      .toContainEqual(expect.objectContaining({ id: "VERSION_UNSUPPORTED", status: "unsupported" }));
    const declared = inventory();
    at(declared.functions).name = "VBD.Example.notListed";
    at(declared.configurations).contract = "unlistedConfiguration.v1";
    const report = upgradeImpact(declared, manifest(), options);
    expect(report.readiness).toBe("incomplete");
    expect(report.findings.filter((item) => item.id === "REFERENCE_UNVERIFIED")).toHaveLength(4);
  });

  it.each(["declared", "denied", "unknown", "unsupported"] as const)("never passes %s registration evidence", (evidence) => {
    const declared = inventory();
    declared.registrations = [{ id: "registrationExample", functionRef: "validateExample", evidence }];
    const report = upgradeImpact(declared, manifest(), options);
    expect(report.readiness).toBe("incomplete");
    expect(report.findings).toContainEqual(expect.objectContaining({
      id: "REGISTRATION_UNVERIFIED", status: evidence === "unsupported" ? "unsupported" : "unknown"
    }));
  });

  it("keeps empty, incomplete and uncovered registration inventories incomplete", () => {
    const declared = inventory();
    declared.registrations = [];
    expect(upgradeImpact(declared, manifest(), options).readiness).toBe("incomplete");
    declared.registrations = inventory().registrations;
    declared.registrationCoverage = "incomplete";
    expect(upgradeImpact(declared, manifest(), options).readiness).toBe("incomplete");
    declared.registrationCoverage = "complete";
    declared.functions.push({ id: "anotherReference", name: "VBD.Config.validate" });
    expect(upgradeImpact(declared, manifest(), options).findings)
      .toContainEqual(expect.objectContaining({ id: "REFERENCE_REGISTRATION_UNCOVERED", subject: "functions.anotherReference" }));
  });

  it.each([-86_400_001, 300_001])("does not pass stale/future metadata, source or registrations at %i ms", (delta) => {
    const stale = new Date(Date.parse(now) + delta).toISOString();
    const metadata = manifest();
    metadata.observedAt = stale;
    const report = upgradeImpact(inventory(), metadata, options);
    expect(report.readiness).toBe("incomplete");
    expect(report.findings.some((item) => item.id === "REFERENCE_SUPPORTED")).toBe(false);
    const declared = inventory();
    declared.observedAt = stale;
    expect(upgradeImpact(declared, manifest(), options).readiness).toBe("incomplete");
    declared.observedAt = now;
    declared.registrations = [{
      id: "registrationExample", functionRef: "validateExample", configurationRef: "configExample",
      evidence: "observed", observedAt: stale
    }];
    expect(upgradeImpact(declared, manifest(), options).findings)
      .toContainEqual(expect.objectContaining({ id: "REGISTRATION_UNVERIFIED", status: "unknown" }));
  });

  it.each([-86_400_000, 300_000])("accepts inclusive freshness limit %i ms", (delta) => {
    const metadata = manifest();
    metadata.observedAt = new Date(Date.parse(now) + delta).toISOString();
    expect(upgradeImpact(inventory(), metadata, options).readiness).toBe("passed");
  });

  it("does not call network or mutate declarations/manifest", () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network."));
    try {
      const declared = inventory();
      const metadata = manifest();
      const before = JSON.stringify([declared, metadata]);
      upgradeImpact(declared, metadata, options);
      expect(JSON.stringify([declared, metadata])).toBe(before);
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
});

describe("C08 strict schemas and bounds", () => {
  it.each(["v0.3.0", "^0.3.0", "latest", "00.3.0", "0.3", "0.3.0-beta", "10000.0.0", "0.3.0+build"])(
    "rejects a version outside bounded release-label grammar: %s", (version) => {
      const declared = inventory();
      declared.targetVersion = version;
      expect(() => upgradeImpact(declared, manifest(), options)).toThrow(/argument/);
      const metadata = manifest();
      at(metadata.versions, 1).version = version;
      expect(() => upgradeImpact(inventory(), metadata, options)).toThrow(/argument/);
    }
  );

  it.each([
    { ...inventory(), values: "VALUE_CANARY" },
    { ...inventory(), sourceRevision: "https://source.example/?VALUE_CANARY" },
    { ...inventory(), functions: [{ id: "validateExample", name: "VBD.Config.validate", value: "VALUE_CANARY" }] },
    { ...inventory(), functions: [] },
    { ...inventory(), registrations: [{ id: "test", functionRef: "notDeclared", evidence: "declared" }] },
    { ...inventory(), registrations: [{ id: "test", functionRef: "validateExample", configurationRef: "notDeclared", evidence: "declared" }] },
    { ...inventory(), registrations: [{ id: "test", functionRef: "validateExample", evidence: "observed" }] },
    { ...inventory(), registrations: [{ id: "test", functionRef: "validateExample", evidence: "denied", observedAt: now }] },
    { ...inventory(), functions: [...inventory().functions, ...inventory().functions] }
  ])("rejects invalid declaration/reference/evidence without retaining raw values %#", (input) => {
    try {
      upgradeImpact(input, manifest(), options);
      expect.fail("Invalid input accepted.");
    } catch (error) {
      expect(error).toMatchObject({ name: "VbdError", code: "INVALID_ARGUMENT", cause: undefined });
      expect(String(error)).not.toContain("VALUE_CANARY");
    }
  });

  it.each(["absent", "self", "deprecatedTarget", "supportedSource"] as const)(
    "rejects invalid replacement link: %s", (mode) => {
      const metadata = manifest();
      const release = at(metadata.versions, 1);
      const api = at(release.functions);
      api.status = mode === "supportedSource" ? "supported" : "deprecated";
      api.replacement = mode === "self" ? api.name : "VBD.Config.get";
      if (mode === "deprecatedTarget" || mode === "supportedSource") {
        release.functions.push({ name: "VBD.Config.get", status: mode === "deprecatedTarget" ? "deprecated" : "supported" });
      }
      expect(() => upgradeImpact(inventory(), metadata, options)).toThrow(/argument/);
    }
  );

  it("rejects duplicate versions/contracts, raw manifest properties and config replacement links", () => {
    const metadata = manifest();
    metadata.versions.push(at(metadata.versions));
    expect(() => upgradeImpact(inventory(), metadata, options)).toThrow(/argument/);
    metadata.versions = manifest().versions;
    at(metadata.versions).functions.push(at(at(metadata.versions).functions));
    expect(() => upgradeImpact(inventory(), metadata, options)).toThrow(/argument/);
    metadata.versions = manifest().versions;
    at(at(metadata.versions).configurations).replacement = "unknownContract";
    expect(() => upgradeImpact(inventory(), metadata, options)).toThrow(/argument/);
    expect(() => upgradeImpact(inventory(), { ...manifest(), url: "https://example.example/?VALUE_CANARY" }, options)).toThrow(/argument/);
  });

  it("enforces 16 versions, 200 APIs, 100 contracts and 500 registration bounds", () => {
    const metadata = manifest();
    metadata.versions = Array.from({ length: 16 }, (_, i) => ({ ...at(manifest().versions), version: `1.0.${i}` }));
    const declared = inventory();
    declared.installedVersion = "1.0.0";
    declared.targetVersion = "1.0.15";
    const release = at(metadata.versions);
    release.functions = Array.from({ length: 200 }, (_, i) => ({ name: `VBD.Example.api${i}`, status: "supported" }));
    release.configurations = Array.from({ length: 100 }, (_, i) => ({ key: `config${i}`, status: "supported" }));
    expect(() => upgradeImpact(declared, metadata, options)).not.toThrow();
    metadata.versions.push({ ...release, version: "2.0.0" });
    expect(() => upgradeImpact(declared, metadata, options)).toThrow(/argument/);
    metadata.versions.pop();
    release.functions.push({ name: "VBD.Example.extra", status: "supported" });
    expect(() => upgradeImpact(declared, metadata, options)).toThrow(/argument/);
    release.functions.pop();
    release.configurations.push({ key: "extraConfig", status: "supported" });
    expect(() => upgradeImpact(declared, metadata, options)).toThrow(/argument/);
    declared.installedVersion = "0.2.0";
    declared.targetVersion = "0.3.0";
    declared.registrations = Array.from({ length: 500 }, (_, i) => ({
      id: `registration${i}`, functionRef: "validateExample", configurationRef: "configExample",
      evidence: "observed", observedAt: now
    }));
    expect(upgradeImpact(declared, manifest(), options).readiness).toBe("passed");
    declared.registrations.push({ id: "tooMany", functionRef: "validateExample", evidence: "declared" });
    expect(() => upgradeImpact(declared, manifest(), options)).toThrow(/argument/);
    declared.registrations = [];
    declared.functions = Array.from({ length: 201 }, (_, i) => ({ id: `api${i}`, name: "VBD.Config.validate" }));
    expect(() => upgradeImpact(declared, manifest(), options)).toThrow(/argument/);
    declared.functions = inventory().functions;
    declared.configurations = Array.from({ length: 101 }, (_, i) => ({ id: `config${i}`, contract: "toolkitConfiguration.v1" }));
    expect(() => upgradeImpact(declared, manifest(), options)).toThrow(/argument/);
  });

  it("accepts exactly 200 inventory functions and 100 configuration references", () => {
    const declared = inventory();
    declared.functions = Array.from({ length: 200 }, (_, i) => ({ id: `api${i}`, name: "VBD.Config.validate" }));
    declared.configurations = Array.from({ length: 100 }, (_, i) => ({ id: `config${i}`, contract: "toolkitConfiguration.v1" }));
    declared.registrations = declared.functions.map((item, i) => ({
      id: `registration${i}`, functionRef: item.id, configurationRef: `config${i % 100}`,
      evidence: "observed", observedAt: now
    }));
    expect(upgradeImpact(declared, manifest(), options).readiness).toBe("passed");
  });

  it("bounds all reference identity/function strings and revision metadata", () => {
    const declared = inventory();
    declared.inventoryId = `i${"x".repeat(127)}`;
    declared.sourceRevision = "a".repeat(40);
    const name = `VBD.Example.${"a".repeat(116)}`;
    at(declared.functions).name = name;
    expect(name).toHaveLength(128);
    expect(() => upgradeImpact(declared, manifest(), options)).not.toThrow();
    at(declared.functions).name += "x";
    expect(() => upgradeImpact(declared, manifest(), options)).toThrow(/argument/);
    at(declared.functions).name = "VBD.Config.validate";
    declared.inventoryId += "x";
    expect(() => upgradeImpact(declared, manifest(), options)).toThrow(/argument/);
    declared.inventoryId = "exampleInventory";
    declared.sourceRevision += "a";
    expect(() => upgradeImpact(declared, manifest(), options)).toThrow(/argument/);
  });
});
