import { readFile, stat, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { Diagnostics } from "../src/diagnostics.js";
import { VbdError } from "../src/errors.js";
import { generateHandover } from "./handover.js";
import { exitCode, preflight } from "./preflight.js";
import type { PreflightOptions } from "./preflight.js";

const maximumBytes = 1024 * 1024;
const help = `VBD local delivery tools (source/supplied-snapshot only)

  vbd-toolkit preflight --config FILE [--snapshot FILE] [--revision SHA] [--output FILE]
  vbd-toolkit handover  --config FILE [--snapshot FILE] [--revision SHA] [--output FILE]

No network access or Dataverse changes. Existing output files are not overwritten.
Exit codes: 0 complete, 1 invalid input/failure, 2 incomplete evidence.
Launch/command runtime and live verification are not implemented.
`;

async function readJson(path: string, operation: "readConfig" | "readSnapshot"): Promise<unknown> {
  let text: string;
  try {
    const metadata = await stat(path);
    if (!metadata.isFile()) {
      throw new VbdError("INPUT_UNREADABLE", { operation });
    }
    if (metadata.size > maximumBytes) {
      throw new VbdError("INPUT_TOO_LARGE", { operation });
    }
    const buffer = await readFile(path);
    if (buffer.byteLength > maximumBytes) {
      throw new VbdError("INPUT_TOO_LARGE", { operation });
    }
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (cause) {
    if (cause instanceof VbdError) {
      throw cause;
    }
    throw new VbdError("INPUT_UNREADABLE", { operation, cause });
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch (cause) {
    throw new VbdError("INVALID_JSON", { operation, cause });
  }
}

async function writeReport(path: string, text: string): Promise<void> {
  try {
    await writeFile(path, text, { encoding: "utf8", flag: "wx" });
  } catch (cause) {
    const exists = typeof cause === "object" && cause !== null &&
      "code" in cause && cause.code === "EEXIST";
    throw new VbdError(exists ? "OUTPUT_EXISTS" : "OUTPUT_UNWRITABLE", {
      operation: "writeReport", cause
    });
  }
}

async function main(argv: string[]): Promise<number> {
  try {
    const [command, ...args] = argv;
    if (!command || command === "--help") {
      process.stdout.write(help);
      return 0;
    }
    if (command !== "preflight" && command !== "handover") {
      throw new VbdError("INVALID_ARGUMENT", { operation: "cli" });
    }
    let parsed;
    try {
      parsed = parseArgs({
        args, strict: true, allowPositionals: false,
        options: {
          config: { type: "string" },
          snapshot: { type: "string" },
          revision: { type: "string" },
          output: { type: "string" },
          help: { type: "boolean" }
        }
      });
    } catch (cause) {
      throw new VbdError("INVALID_ARGUMENT", { operation: "cli", cause });
    }
    if (parsed.values.help) {
      process.stdout.write(help);
      return 0;
    }
    const stringOptions = [
      parsed.values.config, parsed.values.snapshot, parsed.values.revision, parsed.values.output
    ];
    if (!parsed.values.config ||
        stringOptions.some((value) => value !== undefined && value.trim().length === 0)) {
      throw new VbdError("INVALID_ARGUMENT", { operation: "cli" });
    }
    const config = await readJson(parsed.values.config, "readConfig");
    const options: PreflightOptions = {
      ...(parsed.values.snapshot ? { snapshot: await readJson(parsed.values.snapshot, "readSnapshot") } : {}),
      ...(parsed.values.revision ? { sourceRevision: parsed.values.revision } : {})
    };
    const handover = command === "handover" ? generateHandover(config, options) : undefined;
    const report = handover?.report ?? preflight(config, options);
    const text = handover?.markdown ?? `${JSON.stringify(report, null, 2)}\n`;
    if (parsed.values.output) {
      await writeReport(parsed.values.output, text);
      process.stdout.write(`Report written. Readiness: ${report.readiness}.\n`);
    } else {
      process.stdout.write(text);
    }
    return exitCode(report);
  } catch (error) {
    await Diagnostics.report(error, {
      operation: "cli",
      sink: (diagnostic) => { process.stderr.write(`${JSON.stringify(diagnostic)}\n`); }
    });
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
