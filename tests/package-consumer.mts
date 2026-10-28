import * as VBD from "vbd-model-driven-toolkit";
import type {
  ToolkitConfiguration, Diagnostic, ReadContext, ResolvedValue, PreparedLaunch, LaunchResult,
  DataContext, Page, ValidationReport, OperationContract
} from "vbd-model-driven-toolkit";

const result = VBD.Config.validate({});
if (result.valid) {
  const configuration: ToolkitConfiguration = result.configuration;
  VBD.Config.register(configuration.id, configuration);
  VBD.Config.get(configuration.id);
}
const diagnostic: Promise<{ correlationId: string; reported: true }> =
  VBD.Diagnostics.report(new Error("example"), {
    operation: "example",
    sink: (value: Diagnostic): void => { void value; }
  });
void diagnostic;

declare const context: ReadContext;
const flag: Promise<ResolvedValue<boolean>> = VBD.Environment.getBoolean("vbd_Flag", { context });
const prepared: Promise<PreparedLaunch> = VBD.Launch.prepareProfile({
  configurationName: "customerWorkspace", profileKey: "customerWorkspace", context
});
declare const token: PreparedLaunch;
const opened: LaunchResult = VBD.Launch.openPrepared(token);
const url: string = VBD.Links.app({
  environmentUrl: "https://target.example",
  appName: "vbd_Workspace",
  allowedOrigins: ["https://target.example"]
});
void flag;
void prepared;
void opened;
void url;

declare const form: unknown;
declare const execution: unknown;
declare const dataContext: DataContext;
const operation = VBD.Context.fromFormCommand(form);
const text: string | null = VBD.Fields.get(operation, "name", "text");
const controls: string[] = VBD.Controls.forAttribute(operation, "name", control => control.getName());
const report: ValidationReport = VBD.Events.onSave(execution, [
  { id: "requiredName", field: "name", kind: "required" }
]);
const data: Promise<Page> = VBD.Data.retrieveMany("account", {
  entitySet: "accounts", select: ["accountid", "_ownerid_value"], pageSize: 10
}, { context: dataContext });
const contract: OperationContract<{ value: string }> = {
  operationName: "vbd_ReadValue", parameters: {},
  response: {
    kind: "json", status: 200,
    validate: async (value: unknown) => {
      if (typeof value !== "object" || value === null || !("value" in value) || typeof value.value !== "string") {
        throw new Error("Invalid operation response.");
      }
      return { value: value.value };
    }
  }
};
const operationResult: Promise<{ value: string } | undefined> = VBD.Actions.executeFunction(contract, {}, { context: dataContext });
void text;
void controls;
void report;
void data;
void operationResult;

const recordLink: string = VBD.Links.record({
  environmentUrl: "https://target.example", allowedOrigins: ["https://target.example"],
  appName: "vbd_Workspace", record: { entityType: "account", id: "00000000-0000-0000-0000-000000000001" }
});
const viewLink: string = VBD.Links.view({
  environmentUrl: "https://target.example", allowedOrigins: ["https://target.example"],
  appName: "vbd_Workspace", entityName: "account",
  viewId: "00000000-0000-0000-0000-000000000001", viewType: "savedquery"
});
const capabilities: VBD.CapabilityReport = VBD.Diagnostics.getCapabilities();
const pane: Promise<VBD.SidePaneHandle> = VBD.SidePanes.createOrGet({ paneId: "vbd_help", title: "Help" });
declare const paneHandle: VBD.SidePaneHandle;
const page: VBD.SidePanePage = { pageType: "custom", name: "vbd_summary" };
void VBD.SidePanes.navigate(paneHandle, page);
void recordLink;
void viewLink;
void capabilities;
void pane;

const resolvedConfig: Promise<VBD.ResolvedConfiguration> = VBD.Config.resolve("workspace", { context });
const loadedConfig: Promise<ToolkitConfiguration> = VBD.Config.load("workspace", {
  kind: "trustedJson", approved: true, loadJson: async (_maximumBytes) => { void _maximumBytes; return "{}"; }
}, { context });
const bound: Promise<unknown> = VBD.Bindings.resolve({
  source: { kind: "literal", value: false }, type: "boolean"
}, { context });
const cached: Promise<{ enabled: boolean }> = VBD.Cache.getOrLoad({ namespace: "settings", key: "enabled" }, {
  context, approved: true, purpose: "configuration", revision: "v1", ttlMs: 1000,
  load: async () => ({ enabled: false }),
  validate: (value: unknown): value is { enabled: boolean } =>
    typeof value === "object" && value !== null && "enabled" in value && typeof value.enabled === "boolean"
});
const hint: Promise<VBD.AccessAssessment> = VBD.Security.hasPrivilege(
  { name: "prvReadAccount" }, { requiredDepth: "local" }
);
const sameWindow: Promise<VBD.SameWindowResult> = VBD.Launch.openProfile({
  configurationName: "workspace", profileKey: "sameWindowWorkspace", context,
  host: { navigateSameWindow: (_url) => { void _url; } }
});
void resolvedConfig;
void loadedConfig;
void bound;
void cached;
void hint;
void sameWindow;
