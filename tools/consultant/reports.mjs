import { createHash } from "node:crypto";
import { Diagnostics } from "../../dist/index.mjs";
import { inventorySchema, manifestSchema, optionsSchema, parse, policySchema, snapshotSchema } from "./schemas.mjs";

const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const fresh = (observedAt, now) => {
  const age = Date.parse(now) - Date.parse(observedAt);
  return age >= -300_000 && age <= 86_400_000;
};
const evidence = (source, path = "$") => ({ source, path });
const remediation = {
  C05: "Collect fresh authorized sanitized evidence on both sides; verify definitions, types and presence without exporting values.",
  C08: "Verify the exact release and referenced contract with the toolkit maintainer; update declarations manually and run scoped regression checks."
};
const source = (id, kind, input, metadata = {}) => ({
  id, kind, sha256: createHash("sha256").update(JSON.stringify(input)).digest("hex"), ...metadata
});

function start(capabilityId, now, sources) {
  return {
    schemaVersion: 1, capabilityId, toolkitVersion: Diagnostics.getVersion(),
    generatedAt: new Date(now).toISOString(),
    scope: capabilityId === "C05" ? "suppliedSnapshotComparison" : "declaredUpgradeImpact",
    redaction: "Sanitized identifiers, types, presence and access only. No actual values, URLs or records. Input paths and native errors withheld.",
    limitations: [
      "Local supplied evidence only; no network, telemetry, Dataverse collection or writes.",
      "Not independent live deployment, effective-access, licensing or security certification.",
      "No automatic synchronization, rewrite, upgrade or downgrade guarantee."
    ],
    sources, findings: []
  };
}

function add(report, id, status, subject, message, refs, details = {}, action) {
  report.findings.push({
    id, capabilityId: report.capabilityId, status, subject, message,
    remediation: action ?? remediation[report.capabilityId], evidence: refs, details
  });
}

function finish(report) {
  const summary = { pass: 0, warning: 0, fail: 0, unknown: 0, unsupported: 0 };
  for (const finding of report.findings) summary[finding.status]++;
  return {
    ...report, summary,
    readiness: summary.fail ? "failed"
      : summary.warning || summary.unknown || summary.unsupported ? "incomplete" : "passed"
  };
}

function freshness(report, id, observedAt, now) {
  const valid = fresh(observedAt, now);
  add(report, valid ? "EVIDENCE_FRESH" : "EVIDENCE_STALE", valid ? "pass" : "unknown",
    id, valid ? "Supplied evidence is within 24 hours and 5 minutes future skew."
      : "Evidence is stale or exceeds future clock skew; it cannot establish a passing check.",
    [evidence(id, "observedAt")]);
  return valid;
}

export function compareSnapshots(leftInput, rightInput, policyInput, options) {
  const { now } = parse(optionsSchema, options);
  const left = parse(snapshotSchema, leftInput);
  const right = parse(snapshotSchema, rightInput);
  const policy = parse(policySchema, policyInput);
  const report = start("C05", now, [
    source("left", "suppliedSnapshot", left, { targetAlias: left.targetAlias, observedAt: left.observedAt }),
    source("right", "suppliedSnapshot", right, { targetAlias: right.targetAlias, observedAt: right.observedAt }),
    source("policy", "source", policy, { identity: policy.policyId })
  ]);
  const leftFresh = freshness(report, "left", left.observedAt, now);
  const rightFresh = freshness(report, "right", right.observedAt, now);
  const isFresh = leftFresh && rightFresh;
  const index = (snapshot) => new Map(snapshot.environmentVariables.map((item, position) =>
    [item.schemaName.toLowerCase(), { item, position }]));
  const sides = [index(left), index(right)];
  const names = [...new Set([...sides[0].keys(), ...sides[1].keys()])].sort(compareText);
  const used = new Set();
  if (!names.length) {
    add(report, "NO_VARIABLE_EVIDENCE", "unknown", "$", "Neither snapshot contains variable evidence.",
      [evidence("left"), evidence("right")]);
  }
  for (const name of names) {
    const entries = sides.map((side) => side.get(name));
    const [a, b] = entries.map((entry) => entry?.item);
    const refs = entries.map((entry, side) => evidence(side ? "right" : "left",
      entry ? `environmentVariables[${entry.position}]` : "environmentVariables"));
    // This contains only schema-validated structural fields.
    const details = { left: a ?? { status: "unobserved" }, right: b ?? { status: "unobserved" } };
    if (!isFresh) {
      add(report, "VARIABLE_STALE", "unknown", name, "Fresh evidence is required before comparing this variable.", refs, details);
      continue;
    }
    if (!a || !b || [a.status, b.status].some((status) => ["denied", "unknown", "unsupported"].includes(status))) {
      add(report, "VARIABLE_ACCESS_UNVERIFIED",
        [a?.status, b?.status].includes("unsupported") ? "unsupported" : "unknown",
        name, "Omitted or inaccessible evidence does not establish definition, type or presence.", refs, details);
      continue;
    }
    if (a.status === "available" && b.status === "available" && a.type !== b.type) {
      add(report, "VARIABLE_TYPE_CHANGED", "fail", name, "Definition types differ; policy cannot waive a type change.", refs, details);
    }
    if ([a, b].some((item) => item.status === "available" && ["secret", "dataSource"].includes(item.type))) {
      add(report, "VARIABLE_PROTECTED_TYPE", "unsupported", name,
        "Protected or unsupported type evidence cannot establish browser-safe configuration readiness.", refs, details);
      continue;
    }
    const facets = [["definition", a.status === "available", b.status === "available"]];
    if (a.status === "available" && b.status === "available") {
      facets.push(["currentPresence", a.hasCurrentValue, b.hasCurrentValue],
        ["defaultPresence", a.hasDefaultValue, b.hasDefaultValue]);
    } else if (a.status === b.status) {
      add(report, "VARIABLE_BOTH_MISSING", "warning", name,
        "Both definitions are explicitly absent; type and presence cannot be compared.", refs, details);
    }
    for (const [facet, l, r] of facets) {
      if (l === r) continue;
      const ruleIndex = policy.expectedDifferences.findIndex((rule) =>
        rule.schemaName.toLowerCase() === name && rule.facet === facet && rule.left === l && rule.right === r);
      if (ruleIndex >= 0) used.add(ruleIndex);
      add(report, ruleIndex >= 0 ? "EXPECTED_DIFFERENCE" : "UNEXPECTED_DIFFERENCE",
        ruleIndex >= 0 ? "pass" : "fail", `${name}.${facet}`,
        ruleIndex >= 0 ? "The exact directional difference is explicitly permitted by policy."
          : "A structural difference is not covered by the expected-difference policy.",
        ruleIndex >= 0 ? [...refs, evidence("policy", `expectedDifferences[${ruleIndex}]`)] : refs,
        { facet, left: l, right: r });
    }
    if (a.status === "available" && b.status === "available" && a.type === b.type &&
        a.hasCurrentValue === b.hasCurrentValue && a.hasDefaultValue === b.hasDefaultValue) {
      add(report, "VARIABLE_MATCH", "pass", name, "Definition type and value-presence flags match; actual values were not compared.", refs, details);
    }
  }
  policy.expectedDifferences.forEach((rule, position) => {
    if (!used.has(position)) {
      add(report, "POLICY_NOT_ESTABLISHED", "unknown", `${rule.schemaName.toLowerCase()}.${rule.facet}`,
        "This expected difference was not established. It may be unused, reversed, stale, or blocked by incomplete evidence.",
        [evidence("policy", `expectedDifferences[${position}]`)]);
    }
  });
  return finish(report);
}

export function upgradeImpact(inventoryInput, manifestInput, options) {
  const { now } = parse(optionsSchema, options);
  const inventory = parse(inventorySchema, inventoryInput);
  const manifest = parse(manifestSchema, manifestInput);
  const report = start("C08", now, [
    source("inventory", "source", inventory, {
      identity: inventory.inventoryId, observedAt: inventory.observedAt, sourceRevision: inventory.sourceRevision,
      installedVersion: inventory.installedVersion, targetVersion: inventory.targetVersion
    }),
    source("manifest", "suppliedCompatibilityManifest", manifest, {
      identity: manifest.manifestId, observedAt: manifest.observedAt
    })
  ]);
  const inventoryFresh = freshness(report, "inventory", inventory.observedAt, now);
  const manifestFresh = freshness(report, "manifest", manifest.observedAt, now);
  const isFresh = inventoryFresh && manifestFresh;
  for (const role of ["installedVersion", "targetVersion"]) {
    const releaseIndex = manifest.versions.findIndex((item) => item.version === inventory[role]);
    const release = manifest.versions[releaseIndex];
    const versionRefs = [evidence("inventory", role), evidence("manifest",
      release ? `versions[${releaseIndex}]` : "versions")];
    if (!release || release.status === "unsupported" || !isFresh) {
      add(report, !release ? "VERSION_UNKNOWN" : !isFresh ? "VERSION_UNVERIFIED" : "VERSION_UNSUPPORTED",
        release?.status === "unsupported" ? "unsupported" : "unknown", role,
        "Exact version support is not established by fresh supplied metadata; no compatibility is inferred from version order.", versionRefs);
    }
    for (const kind of ["functions", "configurations"]) {
      inventory[kind].forEach((reference, position) => {
        const key = kind === "functions" ? reference.name : reference.contract;
        const entryIndex = release?.[kind].findIndex((item) => (item.name ?? item.key) === key);
        const entry = entryIndex === undefined ? undefined : release[kind][entryIndex];
        const refs = [...versionRefs, evidence("inventory", `${kind}[${position}]`)];
        if (entry) refs.push(evidence("manifest", `versions[${releaseIndex}].${kind}[${entryIndex}]`));
        if (!release || release.status !== "supported" || !isFresh || !entry) {
          add(report, "REFERENCE_UNVERIFIED", "unknown", `${role}.${kind}.${reference.id}`,
            "The exact reference/version contract is unknown, unsupported, or lacks fresh metadata.", refs, { reference: key });
          return;
        }
        const status = { supported: "pass", deprecated: "warning", removed: "fail", unsupported: "unsupported" }[entry.status];
        add(report, `REFERENCE_${entry.status.toUpperCase()}`, status, `${role}.${kind}.${reference.id}`,
          `The supplied manifest marks this exact contract ${entry.status}.`, refs,
          { reference: key, version: release.version, ...(entry.replacement ? { replacement: entry.replacement } : {}) },
          entry.replacement
            ? `Review the supplied replacement ${entry.replacement}; migrate manually and verify registration and regression scenarios.`
            : remediation.C08);
      });
    }
  }
  if (inventory.registrationCoverage !== "complete" || !inventory.registrations.length) {
    add(report, "REGISTRATION_COVERAGE_INCOMPLETE", "unknown", "registrations",
      "Registration inventory is incomplete, unknown or empty; declared references do not prove deployed coverage.",
      [evidence("inventory", "registrationCoverage")]);
  }
  for (const kind of ["functions", "configurations"]) {
    inventory[kind].forEach((reference, position) => {
      const field = kind === "functions" ? "functionRef" : "configurationRef";
      if (!inventory.registrations.some((registration) => registration[field] === reference.id)) {
        add(report, "REFERENCE_REGISTRATION_UNCOVERED", "unknown", `${kind}.${reference.id}`,
          "No supplied registration evidence covers this reference.", [evidence("inventory", `${kind}[${position}]`)]);
      }
    });
  }
  inventory.registrations.forEach((registration, position) => {
    const observed = isFresh && registration.evidence === "observed" && fresh(registration.observedAt, now);
    add(report, observed ? "REGISTRATION_SUPPLIED_OBSERVATION" : "REGISTRATION_UNVERIFIED",
      observed ? "pass" : registration.evidence === "unsupported" ? "unsupported" : "unknown",
      `registrations.${registration.id}`,
      observed ? "Fresh supplied registration observation covers this declaration; it was not independently inspected."
        : "Registration is declared, stale, denied or otherwise unverified; deployment is not established.",
      [evidence("inventory", `registrations[${position}]`)],
      {
        evidence: registration.evidence,
        ...(registration.evidence === "observed" ? { observedAt: registration.observedAt } : {})
      },
      "Have an authorized reviewer inspect deployed wiring and provide fresh sanitized registration evidence; do not infer deployment from source.");
  });
  return finish(report);
}

export function exitCode(report) {
  return report.readiness === "passed" ? 0 : report.readiness === "failed" ? 1 : 2;
}

export function renderMarkdown(report) {
  // All variable strings originated in bounded identifier/time/enum schemas.
  const lines = [
    `# ${report.capabilityId} local consultant report`, "",
    `Report schema: ${report.schemaVersion}; toolkit version: ${report.toolkitVersion}`,
    `Readiness: **${report.readiness}** (limited to ${report.scope})`,
    `Generated: ${report.generatedAt}`, `Summary: ${JSON.stringify(report.summary)}`, "", report.redaction, "",
    ...report.limitations.map((item) => `- ${item}`), "", "## Evidence sources", "",
    ...report.sources.map((item) => `- ${item.id}: ${JSON.stringify(item)}`),
    "", "## Findings", ""
  ];
  for (const item of report.findings) {
    lines.push(`### ${item.id}: ${item.status}`, `Subject: ${item.subject}`, "",
      item.message, "", `Evidence: ${item.evidence.map((ref) => `${ref.source}:${ref.path}`).join(", ")}`,
      `Structural detail: ${JSON.stringify(item.details)}`, `Remediation: ${item.remediation}`, "");
  }
  return `${lines.join("\n")}\n`;
}
