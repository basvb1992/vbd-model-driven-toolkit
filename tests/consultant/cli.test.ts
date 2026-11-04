import { spawnSync } from "node:child_process";
import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { at, inventory, manifest, now, policy, snapshot } from "./fixtures.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const cli = join(root, "tools", "consultant", "cli.mjs");
let directory: string;
function run(args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: "utf8", timeout: 20_000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: "1" }
  });
}
async function json(name: string, value: unknown): Promise<string> {
  const path = join(directory, name);
  await writeFile(path, JSON.stringify(value), "utf8");
  return path;
}
async function compareArgs() {
  return [
    "compare", "--left", await json("left.json", snapshot()),
    "--right", await json("right.json", snapshot()),
    "--policy", await json("policy.json", policy()), "--now", now
  ];
}
async function upgradeArgs() {
  return [
    "upgrade", "--inventory", await json("inventory.json", inventory()),
    "--manifest", await json("manifest.json", manifest()), "--now", now
  ];
}

beforeEach(async () => {
  // Canonicalize OS temp aliases (for example macOS /var) before testing our
  // intentionally strict non-linked-parent boundary.
  directory = await realpath(await mkdtemp(join(tmpdir(), "vbd-consultant-")));
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("consultant CLI contracts", () => {
  it("reports help without reading inputs", () => {
    expect(run(["--help"]).status).toBe(0);
    expect(run([]).stdout).toContain("No telemetry, network");
  });

  it.each([
    ["invalid"], ["compare"], ["compare", "--now", now], ["upgrade", "--left", "unread.json"],
    ["compare", "--help", "--help"], ["compare", "--now", now, "--now", now],
    ["compare", "positional"], ["compare", "--bad", "VALUE_CANARY"],
    ["compare", "--output", " "]
  ])("rejects invalid command arguments %#", (...args) => {
    const result = run(args);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('"code":"INVALID_ARGUMENT"');
    expect(result.stderr).not.toContain("VALUE_CANARY");
    expect(result.stdout).toBe("");
  });

  it("returns 0/1/2 for comparison and deterministic JSON/Markdown", async () => {
    const args = await compareArgs();
    const pass = run(args);
    expect(pass.status).toBe(0);
    expect(pass.stderr).toBe("");
    expect(run(args).stdout).toBe(pass.stdout);
    const markdown = run([...args, "--format", "markdown"]);
    expect(markdown.status).toBe(0);
    expect(markdown.stdout).toContain("# C05 local consultant report");
    expect(markdown.stdout).toContain("Readiness: **passed**");
    const right = snapshot();
    right.environmentVariables[0] = { schemaName: "vbd_ExampleSetting", status: "missing" };
    await json("right.json", right);
    expect(run(args).status).toBe(1);
    right.environmentVariables[0] = { schemaName: "vbd_ExampleSetting", status: "denied" };
    await json("right.json", right);
    expect(run(args).status).toBe(2);
    const invalidFormat = run([...args, "--format", "html"]);
    expect(invalidFormat.status).toBe(1);
  }, 30_000);

  it("returns 0/1/2 for upgrade compatibility and incomplete registration", async () => {
    const args = await upgradeArgs();
    expect(run(args).status).toBe(0);
    const metadata = manifest();
    at(at(metadata.versions, 1).functions).status = "removed";
    await json("manifest.json", metadata);
    expect(run(args).status).toBe(1);
    await json("manifest.json", manifest());
    const declared = inventory();
    declared.registrations = [];
    await json("inventory.json", declared);
    expect(run(args).status).toBe(2);
    expect(run([...args, "--format", "markdown"]).stdout).toContain("REGISTRATION_COVERAGE_INCOMPLETE");
  }, 30_000);

  it("writes only new reports and never overwrites output, input or hard-linked input", async () => {
    const args = await compareArgs();
    const output = join(directory, "report.json");
    const result = run([...args, "--output", output]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("Report written. Readiness: passed.\n");
    const previous = await readFile(output, "utf8");
    expect(previous).toContain('"readiness": "passed"');
    const again = run([...args, "--output", output]);
    expect(again.status).toBe(1);
    expect(again.stderr).toContain("OUTPUT_EXISTS");
    expect(await readFile(output, "utf8")).toBe(previous);
    const input = join(directory, "left.json");
    const original = await readFile(input, "utf8");
    expect(run([...args, "--output", input]).stderr).toContain("OUTPUT_EXISTS");
    expect(await readFile(input, "utf8")).toBe(original);
    const hardLink = join(directory, "linked.json");
    await link(input, hardLink);
    expect(run([...args, "--output", hardLink]).stderr).toContain("OUTPUT_EXISTS");
    expect(await readFile(input, "utf8")).toBe(original);
    const md = join(directory, "report.md");
    expect(run([...args, "--format", "markdown", "--output", md]).status).toBe(0);
    expect(await readFile(md, "utf8")).toContain("# C05 local consultant report");
  }, 30_000);

  it("rejects unsafe output paths, wrong extensions and missing parents without native path/error echoes", async () => {
    const args = await compareArgs();
    for (const output of [
      join(directory, "report.js"), join(directory, "NUL.json"), `${directory}/../VALUE_CANARY.json`,
      join(directory, "report.json:VALUE_CANARY"), join(directory, "report.json."),
      join(directory, "missing", "VALUE_CANARY.json"), "\\\\server.example\\share\\VALUE_CANARY.json",
      join(directory, "VALUE_CANARY?.json")
    ]) {
      const result = run([...args, "--output", output]);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toContain("VALUE_CANARY");
      expect(result.stderr).not.toContain(directory);
      expect(result.stderr).not.toMatch(/ENOENT|EACCES|stack/);
    }
    expect(run([...args, "--format", "markdown", "--output", join(directory, "wrong.json")]).status).toBe(1);
  }, 30_000);

  it("rejects linked output/parent directories without changing linked targets", async () => {
    const args = await compareArgs();
    const input = join(directory, "left.json");
    const output = join(directory, "linked.json");
    const targetDirectory = join(directory, "actual");
    await mkdir(targetDirectory);
    const linkedDirectory = join(directory, "linkedDirectory");
    // Windows junctions do not require developer-mode file-symlink privileges.
    await symlink(targetDirectory, linkedDirectory, process.platform === "win32" ? "junction" : "dir");
    const parentResult = run([...args, "--output", join(linkedDirectory, "report.json")]);
    expect(parentResult.status).toBe(1);
    await link(input, output);
    const before = await readFile(input, "utf8");
    expect(run([...args, "--output", output]).status).toBe(1);
    expect(await readFile(input, "utf8")).toBe(before);
  });

  it("accepts exactly 1 MiB UTF-8 input but rejects oversized files", async () => {
    const args = await compareArgs();
    const content = JSON.stringify(snapshot());
    const exact = content + " ".repeat(1_048_576 - Buffer.byteLength(content));
    await writeFile(join(directory, "left.json"), exact);
    expect(run(args).status).toBe(0);
    await writeFile(join(directory, "left.json"), `${exact} `);
    const result = run(args);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("INPUT_TOO_LARGE");
  });

  it("enforces byte bounds, not UTF-16 string counts", async () => {
    const args = await compareArgs();
    const text = JSON.stringify({ rejected: "é".repeat(524_288) });
    expect(text.length).toBeLessThan(1_048_576);
    await writeFile(join(directory, "left.json"), text, "utf8");
    expect(run(args).stderr).toContain("INPUT_TOO_LARGE");
  });

  it("rejects malformed JSON/UTF-8, raw values, unreadable files and non-regular inputs without echoing payloads", async () => {
    const args = await compareArgs();
    const input = join(directory, "left.json");
    for (const content of [
      '{"VALUE_CANARY":',
      JSON.stringify({ ...snapshot(), value: "VALUE_CANARY" }),
      JSON.stringify({ ...snapshot(), environmentVariables: [{ ...at(snapshot().environmentVariables), currentValue: "VALUE_CANARY" }] }),
      Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x7d])
    ]) {
      await writeFile(input, content);
      const result = run([...args, "--output", join(directory, "not-written.json")]);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toContain("VALUE_CANARY");
      expect(result.stderr).not.toContain(input);
      await expect(readFile(join(directory, "not-written.json"))).rejects.toThrow();
    }
    await rm(input);
    expect(run(args).stderr).toContain("INPUT_UNREADABLE");
    await mkdir(input);
    expect(run(args).stderr).toContain("INPUT_UNREADABLE");
  }, 30_000);

  it("returns sanitized diagnostics for invalid time/version/manifest refs without writing reports", async () => {
    const args = await upgradeArgs();
    const metadata = manifest();
    at(at(metadata.versions).functions).replacement = "VBD.Secret.VALUECANARY";
    await json("manifest.json", metadata);
    const result = run(args);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("INVALID_ARGUMENT");
    expect(result.stderr).not.toContain("VALUECANARY");
    expect(result.stdout).toBe("");
  });
});
