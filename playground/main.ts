import { createReadContext, currentApp } from "./platform.js";
import {
  codeFor, examples, filterExamples, hasMethod, missingMethods, requireCore, runExample, validateInputs
} from "./examples.js";
import type { Example, Inputs, Outcome } from "./examples.js";

function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof type)) throw new Error("Playground markup does not match the compiled handlers.");
  return found;
}
const result = element("result", HTMLPreElement), status = element("status", HTMLParagraphElement);
const version = element("version", HTMLSpanElement), link = element("generated-link", HTMLTextAreaElement);
const code = element("example-code", HTMLPreElement), copyStatus = element("copy-status", HTMLParagraphElement);
const inputStatus = element("input-status", HTMLParagraphElement), copy = element("copy-link", HTMLButtonElement);
const run = element("run-example", HTMLButtonElement), copyCode = element("copy-typescript", HTMLButtonElement);
const search = element("example-search", HTMLInputElement), category = element("category-filter", HTMLSelectElement);
const surface = element("surface-filter", HTMLSelectElement), list = element("example-list", HTMLUListElement);
const candidate: unknown = Reflect.get(globalThis, "VBD");
let selected: Example = examples[0]!, running = false, codeValid = false;
const value = (id: string) => element(id, HTMLInputElement).value.trim();
const actions = new Map<string, readonly string[]>();

function installedVersion(): string {
  if (!hasMethod(candidate, "Diagnostics.getVersion")) return "Core version unavailable";
  try {
    const installed: unknown = requireCore(candidate, ["Diagnostics.getVersion"]).Diagnostics.getVersion();
    return typeof installed === "string" ? `Core ${installed}` : "Core version unavailable";
  } catch { return "Core version unavailable"; }
}
version.textContent = installedVersion();
function safeFailure(error: unknown): void {
  let diagnostic = "";
  if (hasMethod(candidate, "Diagnostics.normalizeError")) {
    try {
      const normalized = requireCore(candidate, ["Diagnostics.normalizeError"]).Diagnostics.normalizeError(error, { operation: "playground.example" });
      // Only safe identifiers; never serialize a cause, message, value or token.
      if (/^[A-Z][A-Z_]{0,63}$/.test(normalized.code)) diagnostic = `${normalized.code}. `;
      if (/^[a-f0-9-]{36}$/i.test(normalized.correlationId)) diagnostic += `Correlation: ${normalized.correlationId}. `;
    } catch { /* Optional diagnostics must not hide the failure or break recovery. */ }
  }
  status.textContent = `${diagnostic}The request failed. Check valid inputs, installed Core methods, host and current-user permissions, then retry. Secret/Data source values are unsupported. No successful result is available.`;
  status.dataset.kind = "error";
  result.textContent = "This request produced no successful result. Server causes, values and tokens are not displayed.";
}
function values(): Inputs {
  return Object.fromEntries(selected.fields.map(field => {
    const control = document.getElementById(`input-${field.id}`);
    return [field.id, control instanceof HTMLInputElement || control instanceof HTMLSelectElement ? control.value : ""];
  }));
}
function legacyCode(): string {
  switch (selected.id) {
    case "library-inspect": return `export function inspect() {
  return { version: VBD.Diagnostics.getVersion(),
    note: "Compiled methods are not native host/permission evidence." };
}`;
    case "record-link": {
      const inputs = linkInputs();
      const api = requireCore(candidate, selected.methods);
      // Pure validation only; this does not navigate or read records.
      if (inputs.mode === "record") api.Links.record({ ...inputs.common, record: { entityType: inputs.entityName, id: inputs.id } });
      else api.Links.view({ ...inputs.common, entityName: inputs.entityName, viewId: inputs.id,
        viewType: inputs.mode === "systemView" ? "savedquery" : "userquery" });
      const common = JSON.stringify(inputs.common, null, 2);
      return `export function buildLink() {
  const common = ${common};
  return ${inputs.mode === "record" ?
    `VBD.Links.record({ ...common, record: ${JSON.stringify({ entityType: inputs.entityName, id: inputs.id })} })` :
    `VBD.Links.view({ ...common, entityName: ${JSON.stringify(inputs.entityName)}, viewId: ${JSON.stringify(inputs.id)}, viewType: ${JSON.stringify(inputs.mode === "systemView" ? "savedquery" : "userquery")} })`};
}`;
    }
    case "environment-read": {
      const schemaName = value("schema-name"), type = variableType();
      const reveal = element("reveal", HTMLInputElement).checked;
      if (!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(schemaName)) throw new Error("Enter an environment-variable schema name.");
      return `// Native consumer host: uses Core's supported SDK context.
export async function readVariable() {
  const resolved = await VBD.Environment.get(${JSON.stringify(schemaName)}, { type: ${JSON.stringify(type)} });
  return { schemaName: resolved.schemaName, type: resolved.type, source: resolved.source,
    cached: resolved.cached, value: ${reveal ? "resolved.value" : '"[hidden]"'} }; // Reveal opt-in: ${reveal}. Never log protected values.
}`;
    }
    case "validate-config": {
      const input = configInput();
      return `export function validate() {
  const report = VBD.Config.validate(JSON.parse(${JSON.stringify(JSON.stringify(input))}));
  return { valid: report.valid, findings: report.findings };
}`;
    }
    default: return "";
  }
}
function refreshCode(): void {
  codeValid = false;
  code.textContent = "";
  try {
    const current = values();
    validateInputs(selected, current);
    code.textContent = codeFor(selected, current, legacyCode());
    codeValid = true;
    inputStatus.textContent = "Code reflects the current validated inputs.";
  } catch {
    // Never leave stale TypeScript presented as current or echo input/parser errors.
    inputStatus.textContent = "Code unavailable: enter valid inputs for this example. For links, first use the current environment and app, then enter a valid table and ID.";
  }
  copyStatus.textContent = "If clipboard access fails, select the code text and copy manually.";
  updateDisabled();
}
function updateDisabled(): void {
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea")
    .forEach(control => { control.disabled = running; });
  list.querySelectorAll("button").forEach(button => { button.disabled = running; });
  for (const [id, methods] of actions) {
    const button = element(id, HTMLButtonElement);
    const missing = missingMethods(candidate, { methods });
    button.disabled = running || missing.length > 0;
    button.title = missing.length ? `Missing ${missing.join(", ")}. Install/publish Core 0.5.0 or newer and refresh.` : "";
  }
  run.disabled = running || !codeValid || missingMethods(candidate, selected).length > 0;
  copyCode.disabled = running || !codeValid;
  copy.disabled = running || !link.value;
}
function renderList(): void {
  const matches = filterExamples(search.value, category.value, surface.value);
  list.replaceChildren();
  for (const item of matches) {
    const li = document.createElement("li"), button = document.createElement("button"), detail = document.createElement("small");
    button.type = "button";
    button.id = `example-${item.id}`;
    button.dataset.exampleId = item.id;
    button.setAttribute("aria-current", String(item.id === selected.id));
    button.textContent = item.title;
    detail.textContent = `${item.category} · ${item.surface}`;
    button.append(detail);
    button.addEventListener("click", () => { if (!running) select(item, true); });
    li.append(button); list.append(li);
  }
  element("catalog-count", HTMLParagraphElement).textContent = `${matches.length} of ${examples.length} examples`;
  element("catalog-empty", HTMLParagraphElement).hidden = matches.length > 0;
  element("example-details", HTMLElement).hidden = matches.length === 0;
  if (matches.length && !matches.some(item => item.id === selected.id)) select(matches[0]!, false);
}
function select(item: Example, focus: boolean): void {
  selected = item;
  const heading = element("example-heading", HTMLHeadingElement);
  heading.textContent = item.title;
  element("example-details", HTMLElement).dataset.exampleId = item.id;
  element("example-description", HTMLParagraphElement).textContent = item.description;
  element("example-requirements", HTMLParagraphElement).textContent = `${item.category} · ${item.surface} · Minimum Core ${item.minimum}. Required methods: ${item.methods.join(", ")}.`;
  element("example-wiring", HTMLParagraphElement).textContent = item.wiring;
  const missing = missingMethods(candidate, item);
  element("availability", HTMLParagraphElement).textContent = missing.length ?
    `Unavailable: ${missing.join(", ")}. Install/publish Core ${item.minimum} or newer and refresh. Other supported examples remain available.` :
    item.surface === "Sitemap HTML" ? "Required compiled methods present. This does not certify permissions or native host support." :
      "Required compiled methods present. Copy only: the actual native form/ribbon host is still required.";
  const fields = element("example-fields", HTMLDivElement);
  fields.replaceChildren();
  for (const field of item.fields) {
    const label = document.createElement("label");
    label.htmlFor = `input-${field.id}`; label.textContent = field.label;
    const control = field.choices ? document.createElement("select") : document.createElement("input");
    control.id = label.htmlFor;
    if (control instanceof HTMLSelectElement) {
      for (const choice of field.choices ?? []) {
        const option = document.createElement("option"); option.value = choice; option.textContent = choice; control.append(option);
      }
    } else { control.maxLength = 256; control.autocomplete = "off"; }
    control.value = field.value;
    control.addEventListener("input", invalidate);
    control.addEventListener("change", invalidate);
    fields.append(label, control);
  }
  for (const id of ["health-tool", "link-tool", "variable-tool", "config-tool"]) element(id, HTMLDivElement).hidden = item.tool !== id;
  run.hidden = item.surface !== "Sitemap HTML" || Boolean(item.tool);
  clearResult();
  renderList();
  refreshCode();
  if (focus) heading.focus();
}
function clearResult(): void {
  result.textContent = "No result for the current selection and inputs. Run an explicit action.";
  status.textContent = "No action has run for the current selection and inputs.";
  status.dataset.kind = "idle";
}
function invalidate(): void {
  if (running) return;
  link.value = ""; copy.disabled = true;
  clearResult(); refreshCode();
}
function action(id: string, methods: readonly string[], task: () => Outcome | Promise<Outcome>): void {
  actions.set(id, methods);
  element(id, HTMLButtonElement).addEventListener("click", () => {
    if (running || missingMethods(candidate, { methods }).length) return;
    running = true;
    updateDisabled();
    status.textContent = "Running. Selection and inputs are locked until completion.";
    status.dataset.kind = "loading";
    result.textContent = "Waiting for the explicit action...";
    result.setAttribute("aria-busy", "true");
    void Promise.resolve().then(task).then(({ output, ok }) => {
      result.textContent = JSON.stringify(output, null, 2);
      status.textContent = ok ? "Example completed. No records or application configuration were written." :
        "Not successful: review the invalid, partial, blocked or incomplete result. No records were written.";
      status.dataset.kind = ok ? "success" : "error";
    }, safeFailure).finally(() => {
      running = false;
      result.setAttribute("aria-busy", "false");
      refreshCode();
    });
  });
}
function configInput(): unknown {
  const text = element("config-json", HTMLTextAreaElement).value;
  if (new TextEncoder().encode(text).byteLength > 262144) throw new Error("Configuration text exceeds its limit.");
  return JSON.parse(text) as unknown;
}
function variableType(): "text" | "number" | "boolean" {
  const type = element("variable-type", HTMLSelectElement).value;
  if (type !== "text" && type !== "number" && type !== "boolean") throw new Error("Choose a supported value type.");
  return type;
}
function linkInputs() {
  const environmentUrl = value("environment-url"), appId = value("app-id"), entityName = value("table");
  const id = value("record-id"), mode = element("link-mode", HTMLSelectElement).value;
  if (!["record", "systemView", "personalView"].includes(mode)) throw new Error("Choose a supported destination.");
  const approvedOrigin = new URL(createReadContext().getScope().environmentUrl).origin;
  return { common: { environmentUrl, appId, allowedOrigins: [approvedOrigin] }, entityName, id, mode };
}
action("inspect", [], () => ({
  ok: true, output: { installed: installedVersion(),
    compiledMethods: Object.fromEntries([...new Set(examples.flatMap(item => item.methods))].map(path => [path, hasMethod(candidate, path)])),
    nativeSdkObservations: hasMethod(candidate, "Diagnostics.getCapabilities") ?
      requireCore(candidate, ["Diagnostics.getCapabilities"]).Diagnostics.getCapabilities() : "Unavailable",
    note: "Presence is not permission or host certification. Expected: no Xrm in sitemap HTML; no fixed API-count assertion." }
}));
action("local", ["Bindings.resolveMany", "Cache.getOrLoad"], async () => {
  const bindings = await runExample(candidate, examples.find(item => item.id === "literal-bindings")!, { count: "0" });
  const cached = await runExample(candidate, examples.find(item => item.id === "memory-cache")!, { count: "0" });
  return { ok: true, output: { bindings: bindings.output, cached: cached.output, networkReads: 0, persistence: "memory-only" } };
});
action("validate", ["Config.validate"], () => {
  const report = requireCore(candidate, ["Config.validate"]).Config.validate(configInput());
  return { ok: report.valid, output: { valid: report.valid, findings: report.findings } };
});
action("current-app", [], async () => {
  const current = await currentApp();
  element("environment-url", HTMLInputElement).value = current.environmentUrl;
  element("app-id", HTMLInputElement).value = current.appId;
  link.value = "";
  return { ok: true, output: { currentAppInputsFilled: true, note: "Only local inputs changed." } };
});
action("build-link", ["Links.record", "Links.view"], () => {
  link.value = "";
  const inputs = linkInputs(), api = requireCore(candidate, ["Links.record", "Links.view"]);
  const url = inputs.mode === "record" ?
    api.Links.record({ ...inputs.common, record: { entityType: inputs.entityName, id: inputs.id } }) :
    api.Links.view({ ...inputs.common, entityName: inputs.entityName, viewId: inputs.id,
      viewType: inputs.mode === "systemView" ? "savedquery" : "userquery" });
  link.value = url;
  return { ok: true, output: { url, destinationCheckedForAccess: false, navigationRequested: false } };
});
action("copy-link", [], async () => {
  try {
    if (!link.value || !navigator.clipboard?.writeText) throw new Error();
    await navigator.clipboard.writeText(link.value);
    return { ok: true, output: { copied: true, navigationRequested: false } };
  } catch {
    link.focus(); link.select();
    return { ok: false, output: { copied: false, recovery: "Select Generated URL and copy manually; clipboard access failed." } };
  }
});
action("read-variable", ["Environment.get"], async () => {
  const reveal = element("reveal", HTMLInputElement).checked;
  const resolved = await requireCore(candidate, ["Environment.get"]).Environment.get(value("schema-name"), { type: variableType(), context: createReadContext() });
  return { ok: true, output: {
    schemaName: resolved.schemaName, type: resolved.type, source: resolved.source, cached: resolved.cached,
    value: reveal ? resolved.value : "[hidden - enable Reveal value to display it]",
    note: "Current-user permissions apply. Secret/Data source types are never returned."
  } };
});
action("run-example", [], () => runExample(candidate, selected, values()));
copyCode.addEventListener("click", () => {
  if (running) return;
  refreshCode(); // Revalidate now, not a stale captured string.
  if (!codeValid) return;
  const text = code.textContent ?? "";
  running = true; updateDisabled();
  copyStatus.textContent = "Copying TypeScript for the current validated inputs...";
  void (async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error();
      await navigator.clipboard.writeText(text);
      copyStatus.textContent = "TypeScript copied for the current validated inputs.";
    } catch {
      copyStatus.textContent = "Clipboard unavailable or denied. Focus the TypeScript text, select it and copy manually (Ctrl+C or Command+C).";
      code.focus();
    } finally { running = false; updateDisabled(); }
  })();
});
for (const [control, entries] of [[category, [...new Set(examples.map(item => item.category))]], [surface, [...new Set(examples.map(item => item.surface))]]] as const) {
  for (const entry of entries) { const option = document.createElement("option"); option.value = entry; option.textContent = entry; control.append(option); }
}
for (const control of [search, category, surface]) control.addEventListener("input", () => { if (!running) renderList(); });
for (const id of ["schema-name", "variable-type", "reveal", "config-json", "environment-url", "app-id", "table", "link-mode", "record-id"]) {
  const control = document.getElementById(id);
  control?.addEventListener("input", invalidate);
  control?.addEventListener("change", invalidate);
}
// No example, network request, native action or environment read is run on load.
select(selected, false);
