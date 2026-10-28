import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configuration } from "./helpers.js";

const cli = resolve("dist", "vbd-toolkit.mjs");
let directory: string;

beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "vbd-toolkit-test-")); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

function run(...args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 15_000 });
}

function file(name: string, value: string): string {
  const path = join(directory, name);
  writeFileSync(path, value);
  return path;
}

describe("delivery CLI", () => {
  it("prints help successfully without reading inputs", () => {
    const result = run("--help");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("No network access");
    expect(result.stderr).toBe("");
  });

  it("returns 2 and valid JSON for an incomplete source preflight", () => {
    const input = file("config.json", JSON.stringify(configuration()));
    const result = run("preflight", "--config", input);
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      readiness: "incomplete", evidenceScope: "source", configurationId: "customerWorkspace"
    });
  });

  it("returns 1 with safe findings for invalid source", () => {
    const input = file("invalid.json", JSON.stringify({ token: "CLI_SECRET_CANARY" }));
    const result = run("preflight", "--config", input);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ readiness: "failed" });
    expect(result.stdout + result.stderr).not.toContain("CLI_SECRET_CANARY");
  });

  it("generates handover but keeps the incomplete exit code", () => {
    const input = file("config.json", JSON.stringify(configuration()));
    const result = run("handover", "--config", input);
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("# VBD toolkit handover");
    expect(result.stdout).toContain("**incomplete**");
  });

  it("writes a new output file and refuses to overwrite it", () => {
    const input = file("config.json", JSON.stringify(configuration()));
    const output = join(directory, "handover.md");
    expect(run("handover", "--config", input, "--output", output).status).toBe(2);
    const original = readFileSync(output, "utf8");
    const repeat = run("handover", "--config", input, "--output", output);
    expect(repeat.status).toBe(1);
    expect(repeat.stderr).toContain("OUTPUT_EXISTS");
    expect(readFileSync(output, "utf8")).toBe(original);
  });

  it("does not overwrite an input file used as the output path", () => {
    const contents = JSON.stringify(configuration());
    const input = file("config.json", contents);
    const result = run("preflight", "--config", input, "--output", input);
    expect(result.status).toBe(1);
    expect(readFileSync(input, "utf8")).toBe(contents);
  });

  it.each(["{INVALID_JSON_CANARY", '{"token":"SECRET_CANARY",}'])(
    "does not leak malformed JSON content: %s", (text) => {
      const result = run("preflight", "--config", file("invalid.json", text));
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("INVALID_JSON");
      expect(result.stderr).not.toContain("CANARY");
    }
  );

  it("accepts exactly 1 MiB and rejects one byte more", () => {
    const json = JSON.stringify(configuration());
    const atLimit = file("limit.json", json.padEnd(1024 * 1024, " "));
    expect(run("preflight", "--config", atLimit).status).toBe(2);
    const tooLarge = file("large.json", json.padEnd(1024 * 1024 + 1, " "));
    const result = run("preflight", "--config", tooLarge);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("INPUT_TOO_LARGE");
  });

  it("rejects unreadable/directory and non-UTF-8 inputs", () => {
    expect(run("preflight", "--config", directory).stderr).toContain("INPUT_UNREADABLE");
    expect(run("preflight", "--config", join(directory, "missing.json")).stderr).toContain("INPUT_UNREADABLE");
    const invalid = join(directory, "utf8.json");
    writeFileSync(invalid, Buffer.from([0xff, 0xfe, 0x7b]));
    expect(run("preflight", "--config", invalid).stderr).toContain("INPUT_UNREADABLE");
  });

  it("rejects invalid supplied snapshots without leaking values", () => {
    const input = file("config.json", JSON.stringify(configuration()));
    const evidence = file("snapshot.json", '{"schemaVersion":1,"value":"SNAPSHOT_CANARY"}');
    const result = run("preflight", "--config", input, "--snapshot", evidence);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("SNAPSHOT_INVALID");
    expect(result.stdout + result.stderr).not.toContain("SNAPSHOT_CANARY");
  });

  it.each(["--snapshot", "--revision", "--output"])(
    "rejects an explicitly empty %s rather than silently ignoring it", (option) => {
      const input = file("config.json", JSON.stringify(configuration()));
      const result = run("preflight", "--config", input, option, "");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("INVALID_ARGUMENT");
    }
  );

  it.each([
    ["unknown"],
    ["preflight"],
    ["preflight", "--unknown=ARGUMENT_CANARY"],
    ["preflight", "--config"]
  ])("returns an explicit safe error for invalid arguments: %j", (...args) => {
    const result = run(...args);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("INVALID_ARGUMENT");
    expect(result.stderr).not.toContain("ARGUMENT_CANARY");
  });
});
