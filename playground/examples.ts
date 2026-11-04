import type * as Toolkit from "../src/index.js";

export type Core = typeof Toolkit;
export type Surface = "Sitemap HTML" | "Form event" | "Form command" | "Grid command";
export type Category = "Diagnostics" | "Forms" | "Commands" | "Navigation" | "Configuration" | "Localization" | "Execution";
export interface Field {
  id: string;
  label: string;
  value: string;
  kind?: "number" | "locale" | "name" | "schema";
  choices?: readonly string[];
}
export interface Example {
  id: string;
  title: string;
  category: Category;
  surface: Surface;
  minimum: "0.5.0" | "0.7.0";
  methods: readonly string[];
  description: string;
  wiring: string;
  fields: readonly Field[];
  tool?: string;
}
const native = "Copy only — not runnable in sitemap HTML. Use a consumer-owned test form/library; this page never supplies Xrm or changes native controls.";
const formWiring = "Bundle this consumer-owned TypeScript as an IIFE with globalName ConsultantExamples in your own JavaScript webresource. Load vbd_/toolkit/vbd.toolkit.js first, then that library. Register ConsultantExamples.onLoad on form OnLoad and enable Pass execution context. Save/publish only your test form.";
const commandWiring = "Bundle this consumer-owned TypeScript as an IIFE with globalName ConsultantExamples in your own command library; load Core first. Ribbon JavaScript action targets ConsultantExamples.formCommand with CRM parameter PrimaryControl. This is not an OnLoad executionContext.";
const field = (id: string, label: string, value: string, kind?: Field["kind"]): Field =>
  ({ id, label, value, ...(kind ? { kind } : {}) });
const example = (input: Example): Example => input;
export const examples: readonly Example[] = [
  example({ id: "library-inspect", title: "Inspect installed library", category: "Diagnostics", surface: "Sitemap HTML", minimum: "0.5.0",
    methods: ["Diagnostics.getVersion"], description: "Observe the installed version and method presence, not permissions or native-client certification.",
    wiring: "Use Inspect library. Native SDK method absence is expected in sitemap HTML even when compiled Core namespaces exist.", fields: [], tool: "health-tool" }),
  example({ id: "form-onload", title: "Form OnLoad record state", category: "Forms", surface: "Form event", minimum: "0.5.0",
    methods: ["Context.fromFormEvent", "Context.getRecord"], description: `${native} Reports saved/unsaved/none without dumping record values.`,
    wiring: formWiring, fields: [] }),
  example({ id: "form-command", title: "Form command record state", category: "Commands", surface: "Form command", minimum: "0.5.0",
    methods: ["Context.fromFormCommand", "Context.getRecord"], description: `${native} Read record state through the supplied form command context.`,
    wiring: commandWiring, fields: [] }),
  example({ id: "grid-command", title: "Grid command selection validation", category: "Commands", surface: "Grid command", minimum: "0.5.0",
    methods: ["Context.fromGridCommand", "Context.getSelection", "Commands.validateSelection"],
    description: `${native} Validates exactly one selected account; does not retrieve rows or navigate.`,
    wiring: "Bundle consumer-owned TypeScript as IIFE globalName ConsultantExamples; load Core first. Ribbon action ConsultantExamples.gridCommand takes CRM parameters SelectedControl, SelectedControlSelectedItemReferences (in that order). Do not pass PrimaryControl or form executionContext.",
    fields: [field("entity", "Expected table logical name", "account", "name")] }),
  example({ id: "lookup-filter", title: "Lookup filter lifecycle", category: "Forms", surface: "Form event", minimum: "0.5.0",
    methods: ["Context.fromFormEvent", "Lookups.addFilter", "Lookups.removeFilter"],
    description: `${native} Registers a fixed active-account filter, removes the previous registration on repeated OnLoad. Review the lookup's target table first.`,
    wiring: `${formWiring} The optional ConsultantExamples.removeLookup command takes no parameters and removes only this wrapper's token.`,
    fields: [field("control", "Account lookup control name", "parentaccountid", "name")] }),
  example({ id: "choice-restore", title: "Choice baseline and restore", category: "Forms", surface: "Form command", minimum: "0.7.0",
    methods: ["Context.fromFormCommand", "Choices.filterOptions", "Choices.restoreOptions"],
    description: `${native} Filters a single-bound choice control, retains the opaque baseline in memory, then restores it on a second explicit command. Rejects excluded selected values; never saves.`,
    wiring: `${commandWiring.replace("ConsultantExamples.formCommand", "ConsultantExamples.filterChoice")} Add a second action ConsultantExamples.restoreChoice with PrimaryControl. Use the same live control; no competing writer. Rebinding/navigation invalidates the token. Never serialize it.`,
    fields: [field("control", "Choice control name", "statuscode", "name"), field("option", "Allowed existing integer option", "1", "number")] }),
  example({ id: "prepared-command", title: "Prepared registry/profile command", category: "Commands", surface: "Form command", minimum: "0.5.0",
    methods: ["Events.onLoad", "Events.onChange", "Commands.run", "Commands.runGrid"],
    description: `${native} Existing trusted registry/profile only; newWindow-only commands. No profile provisioning, async popup workaround or arbitrary operation callback.`,
    wiring: `${formWiring} Register ConsultantExamples.onChange on the relevant form column OnChange with Pass execution context. Pass the existing registry/profile key through this wrapper. Ribbon action ConsultantExamples.formCommand takes PrimaryControl; grid action ConsultantExamples.gridCommand takes SelectedControl, SelectedControlSelectedItemReferences. Preparation must complete before the user clicks; grid-only pages need their own prior supported preparation lifecycle. Reprepare on scope/configuration changes, not inside the click.`,
    fields: [field("key", "Existing registry/profile key", "consultant/account", "schema")] }),
  example({ id: "record-link", title: "Record and view links", category: "Navigation", surface: "Sitemap HTML", minimum: "0.5.0",
    methods: ["Links.record", "Links.view"], description: "Build a same-environment URL without navigation or an access claim. Editable inputs below feed both the code and Build link.",
    wiring: "Use current environment and app only fills inputs. Copy uses your current valid inputs; Build link previews the URL. No records are read.", fields: [], tool: "link-tool" }),
  example({ id: "environment-read", title: "Typed environment-variable read", category: "Configuration", surface: "Sitemap HTML", minimum: "0.5.0",
    methods: ["Environment.get"], description: "Explicit same-origin current-user read, hidden by default. Secret/Data source guards stay in Core.",
    wiring: "Use Read variable below. Copied consumer code uses the native Core read context on a real model-driven host, not this HTML adapter. No token, value or adapter is copied.", fields: [], tool: "variable-tool" }),
  example({ id: "literal-bindings", title: "Literal bindings: false and zero", category: "Configuration", surface: "Sitemap HTML", minimum: "0.5.0",
    methods: ["Bindings.resolveMany"], description: "Resolve fixed typed literal bindings. Zero and false are real values, not missing configuration.",
    wiring: "Run locally with a synthetic scope and a read adapter that always throws; no network or native host required.", fields: [field("count", "Literal count", "0", "number")] }),
  example({ id: "memory-cache", title: "Copy-isolated memory cache", category: "Configuration", surface: "Sitemap HTML", minimum: "0.5.0",
    methods: ["Cache.getOrLoad"], description: "Cache a caller-approved configuration literal for one second. Revision follows the input; no persistence or business data.",
    wiring: "Run locally with a synthetic scope; no network. Core validates and copy-isolates the returned configuration.", fields: [field("count", "Configuration count", "0", "number")] }),
  example({ id: "format-number", title: "Localized number formatting", category: "Localization", surface: "Sitemap HTML", minimum: "0.7.0",
    methods: ["I18n.formatNumber"], description: "Format a finite number with an explicit locale. Uses supported browser Intl, not a guessed user language.",
    wiring: "Pure local formatting, no SDK or data reads. Unsupported browser locale/Intl support fails visibly.", fields: [field("amount", "Number", "1234.5", "number"), field("locale", "Locale (BCP 47)", "en-US", "locale")] }),
  example({ id: "translate", title: "Translate with literal placeholders", category: "Localization", surface: "Sitemap HTML", minimum: "0.7.0",
    methods: ["I18n.translate"], description: "Fixed English/Dutch resources with a literal editable name. Missing resources fail instead of inventing a translation.",
    wiring: "Pure local text, never HTML. Template keys/resources are fixed; only the placeholder value is editable.",
    fields: [{ id: "locale", label: "Resource locale", value: "en-US", choices: ["en-US", "nl-NL"] }, field("person", "Greeting name (not customer data)", "Consultant")] }),
  example({ id: "read-batch", title: "Read batch with partial outcomes", category: "Execution", surface: "Sitemap HTML", minimum: "0.7.0",
    methods: ["Batch.execute"], description: "Two real, fixed local callbacks demonstrate success and a deliberately rejected read guard. Not a Dataverse query editor.",
    wiring: "No network. Only safe item status/count summaries are shown; partial/failed batches never get a success banner.",
    fields: [field("count", "Local integer result", "0", "number"), { id: "outcome", label: "Second read", value: "succeed", choices: ["succeed", "reject"] }] }),
  example({ id: "retry-read", title: "Bounded read-only retry", category: "Execution", surface: "Sitemap HTML", minimum: "0.7.0",
    methods: ["Execution.withRetry"], description: "A fixed local read callback fails once with explicit 429 evidence, then returns your integer. No writes or network.",
    wiring: "A readOnly trust assertion is not a sandbox. Only this fixed callback runs. One attempt intentionally fails; two demonstrate recovery.",
    fields: [field("count", "Local integer result", "0", "number"), { id: "attempts", label: "Maximum attempts", value: "2", choices: ["1", "2"] }] }),
  example({ id: "preflight", title: "Honest read-only preflight", category: "Execution", surface: "Sitemap HTML", minimum: "0.7.0",
    methods: ["Execution.preflight"], description: "A fixed local configuration check reports pass, unknown or fail. It does not certify tenant access, installation or deployment.",
    wiring: "No network, repairs or navigation. Only ready is successful; blocked/incomplete remains visible as such.",
    fields: [{ id: "observation", label: "Local observation to demonstrate", value: "unknown", choices: ["pass", "unknown", "fail"] }] }),
  example({ id: "validate-config", title: "Validate portable configuration", category: "Configuration", surface: "Sitemap HTML", minimum: "0.5.0",
    methods: ["Config.validate"], description: "Validate schema-v1 JSON locally without registration, resolution or code execution.",
    wiring: "Use Validate JSON below. Validation findings are not installation or access checks.", fields: [], tool: "config-tool" })
];

export function filterExamples(search: string, category = "", surface = ""): readonly Example[] {
  const words = search.toLowerCase().trim().split(/\s+/);
  return examples.filter(item => (!category || item.category === category) && (!surface || item.surface === surface) &&
    words.every(word => `${item.id} ${item.title} ${item.category} ${item.surface} ${item.description} ${item.methods.join(" ")}`.toLowerCase().includes(word)));
}
export function hasMethod(input: unknown, path: string): boolean {
  let node: unknown = input;
  for (const key of path.split(".")) {
    if (typeof node !== "object" || node === null) return false;
    node = Reflect.get(node, key);
  }
  return typeof node === "function";
}
export function missingMethods(input: unknown, item: Pick<Example, "methods">): readonly string[] {
  return item.methods.filter(path => !hasMethod(input, path));
}
/** Only use after checking every method used by that fixed path. Never a version-based assertion. */
export function requireCore(input: unknown, methods: readonly string[]): Core {
  if (missingMethods(input, { methods }).length) throw new Error("Required Core methods are unavailable.");
  return input as Core;
}
export type Inputs = Readonly<Record<string, string>>;
export function validateInputs(item: Example, values: Inputs): void {
  for (const spec of item.fields) {
    const value = values[spec.id];
    if (value === undefined || !value.trim() || value.length > 256 ||
      (spec.choices && !spec.choices.includes(value))) throw new Error(`Enter a valid ${spec.label}.`);
    if (spec.kind === "number" && (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) ||
      !Number.isFinite(Number(value)))) throw new Error(`Enter a valid ${spec.label}.`);
    if (spec.kind === "number" && spec.id !== "amount" && !Number.isSafeInteger(Number(value))) throw new Error(`Enter an integer for ${spec.label}.`);
    if (spec.id === "option" && (Number(value) < -2147483648 || Number(value) > 2147483647)) throw new Error("Enter a 32-bit option identity.");
    if (spec.kind === "name" && !/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(value)) throw new Error(`Enter a logical name for ${spec.label}.`);
    if (spec.kind === "schema" && !/^[A-Za-z][A-Za-z0-9._-]{0,127}\/[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error(`Enter configurationName/profileKey for ${spec.label}.`);
    if (spec.kind === "locale") {
      try { if (Intl.getCanonicalLocales(value).length !== 1) throw new Error(); }
      catch { throw new Error("Enter a supported BCP 47 locale, such as en-US."); }
    }
  }
}
// Reserved .invalid origin and synthetic user: no tenant identity, SDK or network.
export function localContext(): Toolkit.ReadContext {
  return {
    getScope: () => ({ environmentUrl: "https://local.invalid", userId: "11111111-1111-1111-1111-111111111111", languageId: 1033, online: true }),
    retrieveMultipleRecords: () => { throw new Error("Local examples cannot make network reads."); }
  };
}
const contextCode = `const context: Toolkit.ReadContext = {
  getScope: () => ({ environmentUrl: "https://local.invalid",
    userId: "11111111-1111-1111-1111-111111111111", languageId: 1033, online: true }),
  retrieveMultipleRecords: () => { throw new Error("Local example: network disabled"); }
};`;
const header = `// Consumer-owned TypeScript; bundle as IIFE globalName: ConsultantExamples.
// Load the separately installed Core library before this wrapper.
import type * as Toolkit from "vbd-model-driven-toolkit";
declare const VBD: typeof Toolkit;
`;
export function codeFor(item: Example, values: Inputs, legacyCode = ""): string {
  validateInputs(item, values);
  const q = (name: string) => JSON.stringify(values[name]);
  const n = (name: string) => String(Number(values[name]));
  let body: string;
  switch (item.id) {
    case "form-onload": body = `export function onLoad(executionContext: unknown) {
  const context = VBD.Context.fromFormEvent(executionContext);
  return { recordState: VBD.Context.getRecord(context).state };
}`; break;
    case "form-command": body = `export function formCommand(PrimaryControl: unknown) {
  const context = VBD.Context.fromFormCommand(PrimaryControl);
  return { recordState: VBD.Context.getRecord(context).state };
}`; break;
    case "grid-command": body = `export function gridCommand(SelectedControl: unknown, SelectedControlSelectedItemReferences: readonly unknown[]) {
  const context = VBD.Context.fromGridCommand(SelectedControl, SelectedControlSelectedItemReferences);
  return VBD.Commands.validateSelection(VBD.Context.getSelection(context), { min: 1, max: 1, entityType: ${q("entity")} });
}`; break;
    case "lookup-filter": body = `let lookup: Toolkit.Disposable | undefined;
export function removeLookup() {
  if (lookup) { VBD.Lookups.removeFilter(lookup); lookup = undefined; }
}
export function onLoad(executionContext: unknown) {
  removeLookup();
  const context = VBD.Context.fromFormEvent(executionContext);
  lookup = VBD.Lookups.addFilter(context, ${q("control")},
    '<filter type="and"><condition attribute="statecode" operator="eq" value="0" /></filter>', "account");
}`; break;
    case "choice-restore": body = `let baseline: Toolkit.ChoiceBaselineToken | undefined;
export function filterChoice(PrimaryControl: unknown) {
  const context = VBD.Context.fromFormCommand(PrimaryControl);
  const changed = VBD.Choices.filterOptions(context, ${q("control")}, [${n("option")}], { excludedValuePolicy: "reject" });
  baseline = changed.baseline; // Keep opaque, same live control only.
  return { status: changed.status };
}
export function restoreChoice(PrimaryControl: unknown) {
  if (!baseline) throw new Error("Filter this live control first.");
  const context = VBD.Context.fromFormCommand(PrimaryControl);
  const restored = VBD.Choices.restoreOptions(context, ${q("control")}, baseline, { excludedValuePolicy: "reject" });
  baseline = undefined;
  return { status: restored.status };
}`; break;
    case "prepared-command": body = `export function onLoad(executionContext: unknown) {
  return VBD.Events.onLoad(executionContext, ${q("key")});
}
export function onChange(executionContext: unknown) {
  return VBD.Events.onChange(executionContext, ${q("key")});
}
export function formCommand(PrimaryControl: unknown) {
  return VBD.Commands.run(PrimaryControl, ${q("key")});
}
export function gridCommand(SelectedControl: unknown, SelectedControlSelectedItemReferences: readonly unknown[]) {
  return VBD.Commands.runGrid(SelectedControl, SelectedControlSelectedItemReferences, ${q("key")});
}`; break;
    case "literal-bindings": body = `${contextCode}
export async function run() {
  return VBD.Bindings.resolveMany({
    enabled: { source: { kind: "literal", value: false }, type: "boolean" },
    count: { source: { kind: "literal", value: ${n("count")} }, type: "number" }
  }, { context });
}`; break;
    case "memory-cache": body = `${contextCode}
export async function run() {
  return VBD.Cache.getOrLoad({ namespace: "playground", key: "editable" }, {
    context, approved: true, purpose: "configuration", revision: ${JSON.stringify(`count:${values.count}`)}, ttlMs: 1000,
    load: async () => ({ count: ${n("count")} }),
    validate: (value: unknown): value is { count: number } =>
      typeof value === "object" && value !== null && "count" in value && value.count === ${n("count")}
  });
}`; break;
    case "format-number": body = `export function run() {
  return VBD.I18n.formatNumber(${n("amount")}, ${q("locale")}, { style: "decimal", maximumFractionDigits: 2 });
}`; break;
    case "translate": body = `export function run() {
  return VBD.I18n.translate("greeting", ${q("locale")}, {
    resources: { "en-US": { greeting: "Hello {name}" }, "nl-NL": { greeting: "Hallo {name}" } },
    values: { name: ${q("person")} }, onMissing: "error"
  });
}`; break;
    case "read-batch": body = `${contextCode}
export async function run() {
  const report = await VBD.Batch.execute<number>([
    { id: "first", kind: "read", run: () => ${n("count")}, validate: (value: unknown): value is number => typeof value === "number" },
    { id: "second", kind: "read", run: () => ${n("count")}, validate: (value: unknown): value is number => typeof value === "number" && ${values.outcome === "succeed"} }
  ], { context, concurrency: 1, failurePolicy: "continue" });
  // Do not dump values or original diagnostics; partial is not success.
  return { status: report.status, counts: report.counts,
    items: report.items.map(item => ({ id: item.id, status: item.status })) };
}`; break;
    case "retry-read": body = `${contextCode}
export async function run() {
  let attempts = 0;
  const value = await VBD.Execution.withRetry(() => {
    attempts++;
    if (attempts === 1) throw Object.assign(new Error("Local transient read"), { status: 429 });
    return ${n("count")};
  }, { context, readOnly: true, policy: { maxAttempts: ${n("attempts")}, initialDelayMs: 0 },
    guard: (value: number) => Number.isSafeInteger(value) });
  return { attempts, value, networkReads: 0 };
}`; break;
    case "preflight": body = `${contextCode}
export async function run() {
  const report = await VBD.Execution.preflight([{
    id: "localConfiguration", readOnly: true,
    run: () => (${observationCode(values.observation ?? "")})
  }], { context, concurrency: 1 });
  // ready only confirms this local demonstration, not tenant access.
  return { status: report.status, counts: report.counts,
    checks: report.checks.map(check => ({ id: check.id, status: check.status, reason: check.reason })) };
}`; break;
    default: body = legacyCode;
  }
  return header + body;
}
function observationCode(value: string): string {
  return value === "pass" ? '{ status: "pass", reason: "confirmed" } as const' :
    value === "fail" ? '{ status: "fail", reason: "not-satisfied" } as const' :
      '{ status: "unknown", reason: "inconclusive" } as const';
}
export interface Outcome { output: unknown; ok: boolean }
export async function runExample(input: unknown, item: Example, values: Inputs): Promise<Outcome> {
  validateInputs(item, values);
  if (item.surface !== "Sitemap HTML" || item.tool) throw new Error("Use the documented host/action for this example.");
  const api = requireCore(input, item.methods), context = localContext(), count = Number(values.count);
  let output: unknown;
  switch (item.id) {
    case "literal-bindings":
      output = await api.Bindings.resolveMany({
        enabled: { source: { kind: "literal", value: false }, type: "boolean" },
        count: { source: { kind: "literal", value: count }, type: "number" }
      }, { context }); break;
    case "memory-cache":
      output = await api.Cache.getOrLoad({ namespace: "playground", key: "editable" }, {
        context, approved: true, purpose: "configuration", revision: `count:${values.count}`, ttlMs: 1000,
        load: async () => ({ count }),
        validate: (value: unknown): value is { count: number } =>
          typeof value === "object" && value !== null && "count" in value && value.count === count
      }); break;
    case "format-number":
      output = api.I18n.formatNumber(Number(values.amount), values.locale ?? "", { style: "decimal", maximumFractionDigits: 2 }); break;
    case "translate":
      output = api.I18n.translate("greeting", values.locale ?? "", {
        resources: { "en-US": { greeting: "Hello {name}" }, "nl-NL": { greeting: "Hallo {name}" } },
        values: { name: values.person ?? "" }, onMissing: "error"
      }); break;
    case "read-batch": {
      const report = await api.Batch.execute<number>([
        { id: "first", kind: "read", run: () => count, validate: (value: unknown): value is number => typeof value === "number" },
        { id: "second", kind: "read", run: () => count, validate: (value: unknown): value is number => typeof value === "number" && values.outcome === "succeed" }
      ], { context, concurrency: 1, failurePolicy: "continue" });
      return { ok: report.status === "succeeded", output: { status: report.status, counts: report.counts,
        items: report.items.map(item => ({ id: item.id, status: item.status })) } };
    }
    case "retry-read": {
      let attempts = 0;
      const value = await api.Execution.withRetry(() => {
        attempts++;
        if (attempts === 1) throw Object.assign(new Error("Local transient read"), { status: 429 });
        return count;
      }, { context, readOnly: true, policy: { maxAttempts: Number(values.attempts), initialDelayMs: 0 },
        guard: (value: number) => Number.isSafeInteger(value) });
      output = { attempts, value, networkReads: 0 }; break;
    }
    case "preflight": {
      const report = await api.Execution.preflight([{
        id: "localConfiguration", readOnly: true, run: () => values.observation === "pass" ?
          { status: "pass", reason: "confirmed" } : values.observation === "fail" ?
            { status: "fail", reason: "not-satisfied" } : { status: "unknown", reason: "inconclusive" }
      }], { context, concurrency: 1 });
      return { ok: report.status === "ready", output: { status: report.status, counts: report.counts,
        checks: report.checks.map(check => ({ id: check.id, status: check.status, reason: check.reason })) } };
    }
    default: throw new Error("No local runner is defined.");
  }
  return { ok: true, output };
}
