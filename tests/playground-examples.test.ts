import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as Core from "../src/index.js";
import { codeFor, examples, filterExamples, hasMethod, localContext, missingMethods, runExample, validateInputs } from "../playground/examples.js";
import type { Example } from "../playground/examples.js";

const byId = (id: string): Example => {
  const found = examples.find(item => item.id === id);
  if (!found) throw new Error(`Unknown test example ${id}`);
  return found;
};
const defaults = (item: Example) => Object.fromEntries(item.fields.map(field => [field.id, field.value]));
const ids = [
  "library-inspect", "form-onload", "form-command", "grid-command", "lookup-filter", "choice-restore",
  "prepared-command", "record-link", "environment-read", "literal-bindings", "memory-cache",
  "format-number", "translate", "read-batch", "retry-read", "preflight", "validate-config"
];
describe("bounded consultant example directory", () => {
  it("has stable exact IDs, categories, surfaces and unique definitions", () => {
    expect(examples.map(item => item.id)).toEqual(ids);
    expect([...new Set(examples.map(item => item.category))]).toEqual([
      "Diagnostics", "Forms", "Commands", "Navigation", "Configuration", "Localization", "Execution"
    ]);
    expect([...new Set(examples.map(item => item.surface))]).toEqual(["Sitemap HTML", "Form event", "Form command", "Grid command"]);
  });
  it("searches IDs, titles and exact API names case-insensitively with combined filters", () => {
    expect(filterExamples("I18n.FORMATNUMBER").map(item => item.id)).toEqual(["format-number"]);
    expect(filterExamples("command", "Commands", "Grid command").map(item => item.id)).toEqual(["grid-command"]);
    expect(filterExamples("literal zero").map(item => item.id)).toEqual(["literal-bindings"]);
    expect(filterExamples("", "Forms").map(item => item.id)).toEqual(["form-onload", "lookup-filter", "choice-restore"]);
    expect(filterExamples("  ")).toHaveLength(17);
    expect(filterExamples("no-such-example")).toEqual([]);
    expect(filterExamples("", "Forms", "Sitemap HTML")).toEqual([]);
  });
  it.each(examples)("documents real methods and valid defaults for $id", item => {
    expect(item.description.length).toBeGreaterThan(40);
    expect(item.wiring.length).toBeGreaterThan(40);
    expect(missingMethods(Core, item)).toEqual([]);
    for (const path of item.methods) expect(hasMethod(Core, path)).toBe(true);
    expect(() => validateInputs(item, defaults(item))).not.toThrow();
    expect(["0.5.0", "0.7.0"]).toContain(item.minimum);
  });
  it("checks presence rather than trusting a version or optional namespaces", () => {
    const older = { Diagnostics: { getVersion: () => "0.7.0" }, Config: Core.Config, Links: Core.Links };
    expect(missingMethods(older, byId("record-link"))).toEqual([]);
    expect(missingMethods(older, byId("format-number"))).toEqual(["I18n.formatNumber"]);
    expect(missingMethods(undefined, byId("preflight"))).toEqual(["Execution.preflight"]);
    expect(missingMethods({ I18n: null }, byId("translate"))).toEqual(["I18n.translate"]);
    expect(hasMethod({ I18n: { translate: true } }, "I18n.translate")).toBe(false);
  });
  it("documents executionContext versus ribbon parameters and actual wrapper targets", () => {
    expect(byId("form-onload").wiring).toMatch(/ConsultantExamples.onLoad.*OnLoad.*Pass execution context/);
    expect(byId("form-command").wiring).toMatch(/ConsultantExamples.formCommand.*PrimaryControl/);
    expect(byId("grid-command").wiring).toContain("SelectedControl, SelectedControlSelectedItemReferences (in that order)");
    expect(codeFor(byId("grid-command"), defaults(byId("grid-command")))).toContain("fromGridCommand(SelectedControl, SelectedControlSelectedItemReferences)");
    expect(codeFor(byId("lookup-filter"), defaults(byId("lookup-filter")))).toContain("VBD.Lookups.removeFilter(lookup)");
    const choice = codeFor(byId("choice-restore"), defaults(byId("choice-restore")));
    expect(choice).toContain("let baseline: Toolkit.ChoiceBaselineToken");
    expect(choice).toContain("baseline = changed.baseline");
    expect(choice).toContain('baseline, { excludedValuePolicy: "reject" }');
    expect(byId("choice-restore").wiring).toContain("Never serialize");
  });
  it("keeps registry commands prepared/newWindow-only, with no async popup workaround", () => {
    const item = byId("prepared-command"), code = codeFor(item, defaults(item));
    expect(item.description).toContain("newWindow-only");
    expect(item.wiring).toContain("Preparation must complete before the user clicks");
    expect(item.wiring).toContain("ConsultantExamples.onChange");
    expect(code).toContain('VBD.Events.onLoad(executionContext, "consultant/account")');
    expect(code).toContain('VBD.Commands.runGrid(SelectedControl, SelectedControlSelectedItemReferences, "consultant/account")');
    expect(code).not.toMatch(/await|window\.open|openProfile/);
    expect(() => codeFor(item, { key: "one/two/three" })).toThrow();
  });
  it.each(["NaN", "Infinity", "", "0x20", "2; alert(1)", "1\n2"])("rejects invalid numeric interpolation %j", count => {
    expect(() => codeFor(byId("literal-bindings"), { count })).toThrow();
  });
  it.each(["-2.5", "2147483648", "_name", 'x");evil();//'])("rejects invalid native option/control input %j", value => {
    const item = byId("choice-restore");
    expect(() => codeFor(item, { control: value, option: value })).toThrow();
  });
  it("interpolates quotes, newlines and script-shaped values as JSON string data only", () => {
    const person = 'A "quote"\n</script><script>globalThis.compromised=true</script>\\test';
    const item = byId("translate"), code = codeFor(item, { locale: "en-US", person });
    expect(code).toContain(`name: ${JSON.stringify(person)}`);
    const compiled = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const sandbox = createContext({ exports: {}, VBD: { I18n: Core.I18n } });
    runInContext(compiled, sandbox);
    expect(runInContext("exports.run()", sandbox)).toBe(`Hello ${person}`);
    expect(sandbox.compromised).toBeUndefined();
    expect(code).not.toMatch(/eval\(|new Function|innerHTML/);
  });
  it("typechecks all generated wrappers against real source contracts (no invented handlers)", () => {
    const files = new Map(examples.filter(item => !item.tool).map(item =>
      [resolve(`tests/playground-examples-${item.id}.virtual.ts`).replace(/\\/g, "/"), codeFor(item, defaults(item))]));
    const options: ts.CompilerOptions = {
      strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler
    };
    const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host);
    host.getSourceFile = (name, language, onError, create) => files.has(name.replace(/\\/g, "/")) ?
      ts.createSourceFile(name, files.get(name.replace(/\\/g, "/"))!, typeof language === "object" ? language.languageVersion : language, true) :
      original(name, language, onError, create);
    host.resolveModuleNames = (names, containingFile) => names.map(name => name === "vbd-model-driven-toolkit" ?
      { resolvedFileName: resolve("src/index.ts"), extension: ts.Extension.Ts } :
      ts.resolveModuleName(name, containingFile, options, host).resolvedModule);
    const program = ts.createProgram([...files.keys()], options, host);
    expect(ts.getPreEmitDiagnostics(program).map(diagnostic =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
  }, 20_000);
  it("preserves native-labelled controls, stable original actions and text-only rendering", async () => {
    const html = await readFile("playground/index.html", "utf8"), source = await readFile("playground/main.ts", "utf8");
    for (const id of ["inspect", "local", "read-variable", "validate", "current-app", "build-link", "copy-link", "result", "status",
      "example-search", "category-filter", "surface-filter", "catalog-empty", "example-code", "copy-typescript", "copy-status"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('for="example-search"');
    expect(source).toContain("code.textContent =");
    expect(source).not.toMatch(/innerHTML|eval\(|new Function|parent\.|window\.open/);
    expect(html).not.toMatch(/@import|<iframe|contenteditable/);
  });
});
describe("fixed safe local runners with no external reads", () => {
  it("synthetic context refuses every network read", () => {
    expect(localContext().getScope().environmentUrl).toBe("https://local.invalid");
    expect(() => localContext().retrieveMultipleRecords("account", "?$select=name", 2)).toThrow("cannot make network");
  });
  it("resolves false/zero and a revision-sensitive cache without a host", async () => {
    expect(await runExample(Core, byId("literal-bindings"), { count: "0" })).toEqual({ ok: true, output: { enabled: false, count: 0 } });
    expect(await runExample(Core, byId("memory-cache"), { count: "3" })).toEqual({ ok: true, output: { count: 3 } });
    expect(await runExample(Core, byId("memory-cache"), { count: "4" })).toEqual({ ok: true, output: { count: 4 } });
  });
  it("uses only the supported formatting/translation paths", async () => {
    expect(await runExample(Core, byId("format-number"), { amount: "1234.5", locale: "en-US" })).toEqual({ ok: true, output: "1,234.5" });
    expect(await runExample(Core, byId("translate"), { locale: "nl-NL", person: "Consultant" })).toEqual({ ok: true, output: "Hallo Consultant" });
    await expect(runExample({}, byId("translate"), { locale: "nl-NL", person: "Consultant" })).rejects.toThrow("unavailable");
  });
  it("does not mistake partial batch results for success or serialize raw errors/values", async () => {
    const partial = await runExample(Core, byId("read-batch"), { count: "2", outcome: "reject" });
    expect(partial).toMatchObject({ ok: false, output: { status: "partial", counts: { succeeded: 1, failed: 1 } } });
    expect(JSON.stringify(partial)).not.toMatch(/diagnostic|correlationId|cause|value|stack/);
    expect(await runExample(Core, byId("read-batch"), { count: "2", outcome: "succeed" })).toMatchObject({ ok: true });
  });
  it("retries a fixed read with explicit evidence, bounds attempts and surfaces exhausted failure", async () => {
    expect(await runExample(Core, byId("retry-read"), { count: "7", attempts: "2" })).toEqual({
      ok: true, output: { attempts: 2, value: 7, networkReads: 0 }
    });
    await expect(runExample(Core, byId("retry-read"), { count: "7", attempts: "1" })).rejects.toMatchObject({ code: "OPERATION_FAILED" });
  });
  it.each([["pass", "ready", true], ["fail", "blocked", false], ["unknown", "incomplete", false]])(
    "keeps preflight %s as %s, success=%s", async (observation, status, ok) => {
      expect(await runExample(Core, byId("preflight"), { observation })).toMatchObject({ ok, output: { status } });
    });
  it.each(examples.filter(item => item.surface !== "Sitemap HTML"))("never runs native $id in the sitemap", async item => {
    const run = vi.fn();
    await expect(runExample({ Context: { fromFormEvent: run } }, item, defaults(item))).rejects.toThrow("documented host");
    expect(run).not.toHaveBeenCalled();
  });
});
