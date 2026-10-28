import type * as Library from "../src/index.js";
import { createReadContext, currentApp } from "./platform.js";

type Api = Pick<typeof Library, "Config" | "Diagnostics" | "Bindings" | "Cache" | "Links" | "Environment">;
function toolkit(input: unknown): input is Api {
  if (typeof input !== "object" || input === null) return false;
  for (const [group, methods] of Object.entries({
    Config: ["validate"], Diagnostics: ["getVersion", "getCapabilities", "normalizeError"],
    Bindings: ["resolveMany"], Cache: ["getOrLoad"], Links: ["record", "view"], Environment: ["get"]
  })) {
    const namespace: unknown = Reflect.get(input, group);
    if (typeof namespace !== "object" || namespace === null ||
        methods.some(method => typeof Reflect.get(namespace, method) !== "function")) return false;
  }
  return true;
}
function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const result = document.getElementById(id);
  if (!(result instanceof type)) throw new Error("Playground markup does not match the compiled handlers.");
  return result;
}
const result = element("result", HTMLPreElement), status = element("status", HTMLParagraphElement);
const version = element("version", HTMLSpanElement), link = element("generated-link", HTMLTextAreaElement);
const copy = element("copy-link", HTMLButtonElement);
const candidate: unknown = Reflect.get(globalThis, "VBD");
if (!toolkit(candidate)) {
  version.textContent = "Core library missing";
  status.textContent = "VBD Core could not load. Install VBDModelDrivenToolkit 0.5.0.0, then refresh this page.";
  status.dataset.kind = "error";
  document.querySelectorAll("button").forEach(button => { button.disabled = true; });
} else {
  const api = candidate;
  version.textContent = `Core ${api.Diagnostics.getVersion()}`;
  let running = false;
  const value = (id: string) => element(id, HTMLInputElement).value.trim();
  function showError(error: unknown): void {
    const normalized = api.Diagnostics.normalizeError(error, { operation: "playground.example" });
    status.textContent = `${normalized.code}: ${normalized.message} Check the inputs and retry. Correlation: ${normalized.correlationId}`;
    status.dataset.kind = "error";
    result.textContent = "This request produced no successful result.";
  }
  function action(id: string, task: () => unknown | Promise<unknown>): void {
    const button = element(id, HTMLButtonElement);
    button.addEventListener("click", () => {
      if (running) {
        status.textContent = "An example is still running. Wait for it to finish.";
        return;
      }
      running = true;
      document.querySelectorAll("button").forEach(control => { control.disabled = true; });
      status.textContent = "Running the selected example...";
      status.dataset.kind = "loading";
      result.setAttribute("aria-busy", "true");
      void Promise.resolve().then(task).then(output => {
        if (output !== undefined) result.textContent = JSON.stringify(output, null, 2);
        status.textContent = "Example completed. No records or application configuration were written.";
        status.dataset.kind = "success";
      }, showError).finally(() => {
        running = false;
        document.querySelectorAll("button").forEach(control => { control.disabled = false; });
        copy.disabled = !link.value;
        result.setAttribute("aria-busy", "false");
      });
    });
  }
  action("inspect", () => ({
    version: api.Diagnostics.getVersion(), capabilities: api.Diagnostics.getCapabilities(),
    note: "This sitemap HTML page is not a form context. Missing Xrm methods here are expected."
  }));
  action("local", async () => {
    const context = createReadContext();
    const bindings = await api.Bindings.resolveMany({
      enabled: { source: { kind: "literal", value: false }, type: "boolean" },
      count: { source: { kind: "literal", value: 0 }, type: "number" }
    }, { context });
    const cached = await api.Cache.getOrLoad({ namespace: "playground", key: "example" }, {
      context, approved: true, purpose: "configuration", revision: "example-v1", ttlMs: 1000,
      load: async () => ({ enabled: false, count: 0 }),
      validate: (input: unknown): input is { enabled: boolean; count: number } =>
        typeof input === "object" && input !== null && "enabled" in input && input.enabled === false &&
        "count" in input && input.count === 0
    });
    return { bindings, cached, networkReads: 0, persistence: "memory-only" };
  });
  action("validate", () => {
    const text = element("config-json", HTMLTextAreaElement).value;
    if (new TextEncoder().encode(text).byteLength > 262144) throw new Error("Configuration text exceeds its limit.");
    const input: unknown = JSON.parse(text);
    const report = api.Config.validate(input);
    return { valid: report.valid, findings: report.findings };
  });
  action("current-app", async () => {
    const current = await currentApp();
    element("environment-url", HTMLInputElement).value = current.environmentUrl;
    element("app-id", HTMLInputElement).value = current.appId;
    return { currentAppInputsFilled: true, note: "Only the local form inputs changed." };
  });
  action("build-link", () => {
    const environmentUrl = value("environment-url"), appId = value("app-id"), entityName = value("table");
    const id = value("record-id"), mode = element("link-mode", HTMLSelectElement).value;
    link.value = "";
    copy.disabled = true;
    if (!["record", "systemView", "personalView"].includes(mode)) throw new Error("Choose a supported destination.");
    const approvedOrigin = new URL(createReadContext().getScope().environmentUrl).origin;
    const common = { environmentUrl, appId, allowedOrigins: [approvedOrigin] };
    const url = mode === "record"
      ? api.Links.record({ ...common, record: { entityType: entityName, id } })
      : api.Links.view({ ...common, entityName, viewId: id,
        viewType: mode === "systemView" ? "savedquery" : "userquery" });
    link.value = url;
    copy.disabled = false;
    return { url, destinationCheckedForAccess: false, navigationRequested: false };
  });
  action("copy-link", async () => {
    if (!link.value || !navigator.clipboard?.writeText) throw new Error("Select the generated URL and copy it manually.");
    await navigator.clipboard.writeText(link.value);
    return { copied: true, navigationRequested: false };
  });
  action("read-variable", async () => {
    const type = element("variable-type", HTMLSelectElement).value;
    if (type !== "text" && type !== "number" && type !== "boolean") throw new Error("Choose a supported value type.");
    const resolved = await api.Environment.get(value("schema-name"), { type, context: createReadContext() });
    const reveal = element("reveal", HTMLInputElement).checked;
    return {
      schemaName: resolved.schemaName, type: resolved.type, source: resolved.source, cached: resolved.cached,
      value: reveal ? resolved.value : "[hidden - enable Reveal value to display it]",
      note: "Reads use your current Dataverse permissions. Secret/Data source types are never returned."
    };
  });
}
