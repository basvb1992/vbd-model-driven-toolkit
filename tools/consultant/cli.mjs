import { parseArgs } from "node:util";
import { Diagnostics, VbdError } from "../../dist/index.mjs";
import { readJson, writeReport } from "./io.mjs";
import { compareSnapshots, exitCode, renderMarkdown, upgradeImpact } from "./reports.mjs";

const help = `VBD local consultant tools (C05 / C08)

  node tools/consultant/cli.mjs compare --left FILE --right FILE --policy FILE --now ISO [--format json|markdown] [--output FILE]
  node tools/consultant/cli.mjs upgrade --inventory FILE --manifest FILE --now ISO [--format json|markdown] [--output FILE]

Build shared APIs first: npm run build
--now is required; reports are deterministic for fixed inputs and observation time.
Files: local regular UTF-8 JSON, at most 1 MiB each; see docs/consultant-tools.md.
Output: stdout or new .json/.md file in an existing non-linked directory. Never overwrite.
Exit: 0 passed in bounded scope, 1 failed/invalid, 2 incomplete evidence.
No telemetry, network, Dataverse reads/writes, automatic rewrites or upgrades.
`;

export async function main(argv) {
  try {
    const [command, ...args] = argv;
    if (command === "--help" || argv.length === 0) {
      process.stdout.write(help);
      return 0;
    }
    if (!["compare", "upgrade"].includes(command)) {
      throw new VbdError("INVALID_ARGUMENT", { operation: "consultant.cli" });
    }
    const required = command === "compare" ? ["left", "right", "policy"] : ["inventory", "manifest"];
    let values;
    try {
      const parsed = parseArgs({
        args, strict: true, allowPositionals: false,
        options: {
          ...Object.fromEntries(required.map((key) => [key, { type: "string" }])),
          now: { type: "string" }, format: { type: "string" },
          output: { type: "string" }, help: { type: "boolean" }
        },
        tokens: true
      });
      const optionNames = parsed.tokens.filter((token) => token.kind === "option").map((token) => token.name);
      if (new Set(optionNames).size !== optionNames.length) throw new Error();
      values = parsed.values;
    } catch {
      throw new VbdError("INVALID_ARGUMENT", { operation: "consultant.cli" });
    }
    if (values.help) {
      process.stdout.write(help);
      return 0;
    }
    if ([...required, "now"].some((key) => !values[key]) ||
        Object.values(values).some((value) => typeof value === "string" && !value.trim()) ||
        (values.format !== undefined && !["json", "markdown"].includes(values.format))) {
      throw new VbdError("INVALID_ARGUMENT", { operation: "consultant.cli" });
    }
    const inputs = await Promise.all(required.map((key) => readJson(values[key])));
    const options = { now: values.now };
    const report = command === "compare" ? compareSnapshots(...inputs, options) : upgradeImpact(...inputs, options);
    const format = values.format ?? "json";
    const text = format === "markdown" ? renderMarkdown(report) : `${JSON.stringify(report, null, 2)}\n`;
    if (values.output !== undefined) {
      await writeReport(values.output, text, format);
      process.stdout.write(`Report written. Readiness: ${report.readiness}.\n`);
    } else {
      process.stdout.write(text);
    }
    return exitCode(report);
  } catch (error) {
    await Diagnostics.report(error, {
      operation: "consultant.cli",
      sink: (diagnostic) => { process.stderr.write(`${JSON.stringify(diagnostic)}\n`); }
    });
    return 1;
  }
}

// Keep the entry separate from pure report functions; importing reports has no I/O.
process.exitCode = await main(process.argv.slice(2));
