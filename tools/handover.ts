import { Config } from "../src/configuration.js";
import { VbdError } from "../src/errors.js";
import { preflight } from "./preflight.js";
import type { PreflightOptions, PreflightReport } from "./preflight.js";

export function generateHandover(
  input: unknown,
  options: PreflightOptions = {}
): { markdown: string; report: PreflightReport } {
  const validated = Config.validate(input);
  if (!validated.valid) {
    throw new VbdError("CONFIG_INVALID", { operation: "handover" });
  }
  const config = validated.configuration;
  const report = preflight(config, options);
  const lines = [
    "# VBD toolkit handover", "",
    `- Document/schema version: 1`,
    `- Toolkit version: ${report.toolkitVersion}`,
    `- Configuration: \`${config.id}\``,
    `- Generated: ${report.generatedAt}`,
    `- Source revision: ${report.sourceRevision ?? "Not supplied"}`,
    `- Evidence scope: ${report.evidenceScope}`,
    `- Target alias: ${report.targetAlias ?? "Not inspected"}`,
    `- Snapshot observed: ${report.snapshotObservedAt ?? "Not supplied"}`,
    `- Readiness: **${report.readiness}**`, "",
    "## Scope and limitations", "",
    "This document records declared configuration, not proof of installation.",
    "Snapshot findings are supplied evidence, not independently verified live access.",
    "Runtime helpers and prepared-profile command entry points are implemented; they were not executed or inspected here.",
    "No apps were opened, business records read, or environment components changed.",
    "Raw current/default values, destinations, credentials, and record payloads are omitted.",
    "The Workflow/Interaction Framework is not a dependency.", "",
    "## Environment-variable requirements", "",
    "| Schema name | Declared type | Required | Evidence status |",
    "| --- | --- | --- | --- |"
  ];
  config.environmentVariables.forEach((item, index) => {
    const finding = report.findings.find((value) => value.path === `environmentVariables[${index}]`);
    lines.push(`| \`${item.schemaName}\` | ${item.type} | ${item.required ? "Yes" : "No"} | ${finding?.status ?? "unknown"} |`);
  });
  lines.push("", "## Launch-profile declarations", "",
    "| Profile | App-ID variable | Environment | Approved-origin variables |",
    "| --- | --- | --- | --- |");
  for (const profile of config.launchProfiles) {
    lines.push(`| \`${profile.key}\` | \`${profile.appId.environmentVariable}\` | ${
      profile.environmentUrl ? `\`${profile.environmentUrl.environmentVariable}\`` : "Current environment"
    } | ${profile.allowedOrigins.map((item) => `\`${item.environmentVariable}\``).join(", ")} |`);
  }
  lines.push("", "## Declared command wiring", "",
    "**Declared templates only: bootstrap the registry and prepare on load. Deployed wiring was not inspected.**",
    "Templates assume the configuration is registered using its id; adjust the registry-name prefix for a caller-owned alias.", "",
    "| Registration | Surface | Function | Parameters | Verification |",
    "| --- | --- | --- | --- | --- |");
  for (const registration of config.registrations) {
    const form = registration.surface === "formCommand";
    lines.push(`| \`${registration.id}\` | ${registration.surface} | \`${
      form ? "VBD.Commands.run" : "VBD.Commands.runGrid"
    }\` | ${form ? "PrimaryControl" : "SelectedControl, selected references"}, \`${config.id}/${registration.profileKey}\` | Declared only; not deployed/verified |`);
  }
  lines.push("", "## Findings", "",
    "| Check | Status | Path | Evidence | Finding and next action |",
    "| --- | --- | --- | --- | --- |");
  for (const finding of report.findings) {
    lines.push(`| ${finding.id} | ${finding.status} | \`${finding.path}\` | ${finding.evidence} | ${finding.message} ${finding.remediation} |`);
  }
  lines.push("", "## Troubleshooting and dependencies", "",
    "- Fix source schema/reference issues before deploying.",
    "- Check environment-variable definitions and value presence with authorized access; never paste secrets into reports.",
    "- Unknown or unsupported findings are not passes; refresh stale evidence.",
    "- Actual app access, origin values, command registration, and browser behavior need separate live verification.",
    "- Consumer wiring must distinguish classic ribbon and modern command-designer support.",
    "- Call VBD.Events.onLoad with execution context and the same registry/profile key before enabling the command.",
    "- No Studio, workflow framework, customer tables, or Dynamics module is required for this source-level tooling.", "");
  return { markdown: lines.join("\n"), report };
}
