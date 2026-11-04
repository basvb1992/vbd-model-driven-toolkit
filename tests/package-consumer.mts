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

const locked: Promise<VBD.CompletedLockResult<number>> = VBD.Execution.withLock(
  { namespace: "consumerCommands", key: "load" }, async () => 0, { context }
);
const busyOrValue: Promise<VBD.CompletedLockResult<string> | VBD.BusyLockResult> =
  VBD.Execution.withLock({ namespace: "consumerCommands", key: "submit" }, () => "done",
    { context, duplicate: "return-busy" });
declare const thenable: PromiseLike<number>;
const flattened: Promise<VBD.CompletedLockResult<number>> = VBD.Execution.withLock(
  { namespace: "consumerCommands", key: "flatten" }, () => thenable, { context }
);
void locked;
void busyOrValue;
void flattened;

declare const metadataContext: VBD.MetadataContext;
const tableMetadata: Promise<VBD.TableMetadata> = VBD.Metadata.getTable("account", { context: metadataContext });
const columnMetadata: Promise<VBD.ColumnMetadata> = VBD.Metadata.getColumn("account", "name", { context: metadataContext });
const choiceMetadata: Promise<VBD.ChoiceMetadata> = VBD.Metadata.getChoices("account", "accountcategorycode", {
  context: metadataContext, languageId: 1033
});
const relationships: Promise<VBD.RelationshipMetadata> = VBD.Metadata.getRelationships("account", {
  context: metadataContext, kind: "oneToMany"
});
const switched: Promise<VBD.FormSwitchResult> = VBD.Forms.switchForm(form,
  "00000000-0000-0000-0000-000000000001", { dirtyPolicy: "reject" });
const optionResult: VBD.ChoiceMutationResult = VBD.Choices.setOptions(form, "choiceControl",
  [{ value: 0, text: "" }], { excludedValuePolicy: "reject" });
const restored: VBD.ChoiceRestoreResult = VBD.Choices.restoreOptions(form, "choiceControl", optionResult.baseline);
const filtered: VBD.ChoiceMutationResult = VBD.Choices.filterOptions(form, "choiceControl", [0]);
void tableMetadata;
void columnMetadata;
void choiceMetadata;
void relationships;
void switched;
void restored;
void filtered;

const readBatch: Promise<VBD.ReadBatchResult<{ count: number }>> = VBD.Batch.execute([{
  id: "count", kind: "read", run: async () => ({ count: 0 }),
  validate: (value: unknown): value is { count: number } =>
    typeof value === "object" && value !== null && "count" in value && typeof value.count === "number"
}], { context, concurrency: 4, failurePolicy: "stop", maxResultBytes: 1048576 });
declare const batchResult: VBD.ReadBatchResult<{ count: number }>;
for (const item of batchResult.items) {
  if (item.status === "succeeded") { const count: number = item.value.count; void count; }
  else if (item.status === "failed") { const code: string = item.error.code; void code; }
  else { const reason: Exclude<VBD.BatchStopReason, "none"> = item.reason; void reason; }
}
void readBatch;

const retriedRead: Promise<number> = VBD.Execution.withRetry(() => 0, {
  readOnly: true, context, guard: value => typeof value === "number",
  policy: { maxAttempts: 3, initialDelayMs: 250 }
});
const checkedReads: Promise<VBD.PreflightReport> = VBD.Execution.preflight([{
  id: "approvedRead", readOnly: true, run: () => ({ status: "pass", reason: "confirmed" })
}], { context, concurrency: 4 });
void retriedRead;
void checkedReads;

const language: VBD.LanguageInfo = VBD.I18n.getLanguage({
  context: {
    environmentUrl: "https://fixture.example", userId: "11111111-2222-3333-4444-555555555555", languageId: 1033
  }
});
const translated: string = VBD.I18n.translate("status", "en-US", {
  resources: { "en-US": { status: "{count}/{enabled}" } },
  onMissing: "error", values: { count: 0, enabled: false }
});
const formattedNumber: string = VBD.I18n.formatNumber(1234.5, "de-DE", { style: "decimal" });
const formattedDate: string = VBD.I18n.formatDate("2024-02-29", "en-GB", { behavior: "dateOnly", dateStyle: "long" });
const displayed: string = VBD.Utils.formatValue({
  kind: "boolean", value: false, labels: { true: "Yes", false: "No" }
}, { locale: "en-US", nulls: { policy: "error" } });
void language;
void translated;
void formattedNumber;
void formattedDate;
void displayed;
