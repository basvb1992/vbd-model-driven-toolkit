import { z } from "zod";
import { entityRefSchema } from "./entity-reference.js";
import type { EntityRef } from "./entity-reference.js";
import { Diagnostics } from "./diagnostics.js";
import { messageForCode, VbdError } from "./errors.js";
import { approvedOrigin } from "./links.js";
import { call, callAsync, messageSchema, resultOf, sdkRoot } from "./sdk.js";
import { guidSchema, logicalNameSchema, parseInput } from "./validation.js";

const sizeSchema = z.union([
  z.number().int().min(1).max(4096),
  z.object({ value: z.number().min(1).max(4096), unit: z.enum(["px", "%"]) }).strict()
    .refine(value => value.unit !== "%" || value.value <= 100)
]);
const presentationSchema = z.object({
  mode: z.enum(["inline", "dialog"]).default("inline"),
  title: messageSchema.optional(),
  width: sizeSchema.optional(), height: sizeSchema.optional(),
  position: z.enum(["center", "side"]).default("center")
}).strict();
export type PresentationOptions = z.input<typeof presentationSchema>;
const defaultsSchema = z.record(logicalNameSchema, z.union([
  z.string().max(1_048_576), z.number().finite(), z.boolean()
])).refine(value => Object.keys(value).length <= 100);
const recordOptions = presentationSchema.extend({
  formId: guidSchema.optional(), tabName: z.string().min(1).max(256).optional(),
  data: defaultsSchema.optional()
});
function navigationOptions(input: z.output<typeof presentationSchema>) {
  if (input.mode === "inline") {
    if (input.width !== undefined || input.height !== undefined || input.title !== undefined || input.position !== "center") {
      throw new VbdError("INVALID_ARGUMENT", { operation: "navigation.options" });
    }
    return { target: 1 };
  }
  return {
    target: 2, position: input.position === "side" ? 2 : 1,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.width === undefined ? {} : { width: input.width }),
    ...(input.height === undefined ? {} : { height: input.height })
  };
}
async function navigate(page: Record<string, unknown>, options: z.output<typeof presentationSchema>): Promise<{
  status: "navigated" | "closed"; result: unknown;
}> {
  const result = await callAsync(sdkRoot(["Navigation"]), "navigateTo", page, navigationOptions(options));
  return { status: options.mode === "dialog" ? "closed" : "navigated", result };
}
async function openRecord(ref: EntityRef, input: z.input<typeof recordOptions> = {}) {
  const record = parseInput(entityRefSchema, ref, "navigation.openRecord");
  const options = parseInput(recordOptions, input, "navigation.openRecord");
  return navigate({
    pageType: "entityrecord", entityName: record.entityType, entityId: record.id,
    ...(options.formId === undefined ? {} : { formId: options.formId }),
    ...(options.tabName === undefined ? {} : { tabName: options.tabName }),
    ...(options.data === undefined ? {} : { data: options.data })
  }, options);
}
async function newRecord(entityName: string, input: z.input<typeof recordOptions> = {}) {
  parseInput(logicalNameSchema, entityName, "navigation.newRecord");
  const options = parseInput(recordOptions, input, "navigation.newRecord");
  return navigate({
    pageType: "entityrecord", entityName,
    ...(options.formId === undefined ? {} : { formId: options.formId }),
    ...(options.tabName === undefined ? {} : { tabName: options.tabName }),
    ...(options.data === undefined ? {} : { data: options.data })
  }, options);
}
async function quickCreate(
  entityName: string, input: { formId?: string; data?: Record<string, string | number | boolean> } = {}
): Promise<{ status: "saved"; records: EntityRef[] }> {
  parseInput(logicalNameSchema, entityName, "navigation.quickCreate");
  const options = parseInput(z.object({ formId: guidSchema.optional(), data: defaultsSchema.optional() }).strict(),
    input, "navigation.quickCreate");
  const result = await callAsync(sdkRoot(["Navigation"]), "openForm", {
    entityName, useQuickCreateForm: true,
    ...(options.formId === undefined ? {} : { formId: options.formId })
  }, options.data ?? {});
  const parsed = resultOf(z.object({ savedEntityReference: z.array(entityRefSchema).min(1).max(100) }), result);
  return { status: "saved", records: parsed.savedEntityReference };
}
async function openView(
  entityName: string, input: { viewId?: string; viewType?: "savedquery" | "userquery" } = {}
) {
  parseInput(logicalNameSchema, entityName, "navigation.openView");
  const options = parseInput(z.object({
    viewId: guidSchema.optional(), viewType: z.enum(["savedquery", "userquery"]).optional()
  }).strict(), input, "navigation.openView");
  if (options.viewType && !options.viewId) throw new VbdError("INVALID_ARGUMENT", { operation: "navigation.openView" });
  return navigate({ pageType: "entitylist", entityName, ...options },
    parseInput(presentationSchema, {}, "navigation.openView"));
}
async function openDashboard(dashboardId: string) {
  return navigate({ pageType: "dashboard", dashboardId: parseInput(guidSchema, dashboardId, "navigation.openDashboard") },
    parseInput(presentationSchema, {}, "navigation.openDashboard"));
}
async function openCustomPage(name: string, input: PresentationOptions & {
  entityName?: string | undefined; recordId?: string | undefined;
} = {}) {
  parseInput(logicalNameSchema, name, "navigation.openCustomPage");
  const options = parseInput(presentationSchema.extend({
    entityName: logicalNameSchema.optional(), recordId: guidSchema.optional()
  }), input, "navigation.openCustomPage");
  if (options.recordId && !options.entityName) throw new VbdError("INVALID_ARGUMENT", { operation: "navigation.openCustomPage" });
  return navigate({
    pageType: "custom", name,
    ...(options.entityName === undefined ? {} : { entityName: options.entityName }),
    ...(options.recordId === undefined ? {} : { recordId: options.recordId })
  }, options);
}
async function openWebResource(name: string, input: PresentationOptions & { data?: string | undefined } = {}) {
  parseInput(z.string().min(1).max(256).regex(/^[A-Za-z0-9_][A-Za-z0-9_./-]*$/).refine(value => !value.includes("..")),
    name, "navigation.openWebResource");
  const options = parseInput(presentationSchema.extend({ data: z.string().max(262144).optional() }),
    input, "navigation.openWebResource");
  return navigate({
    pageType: "webresource", webresourceName: name,
    ...(options.data === undefined ? {} : { data: options.data })
  }, options);
}
function openUrl(input: {
  url: string; allowedOrigins: string[]; allowedQueryKeys?: string[]; width?: number; height?: number;
}): { status: "requested" } {
  const options = parseInput(z.object({
    url: z.string().max(32768), allowedOrigins: z.array(z.string()).min(1).max(20),
    allowedQueryKeys: z.array(logicalNameSchema).max(100).default([]),
    width: z.number().int().min(100).max(4096).optional(),
    height: z.number().int().min(100).max(4096).optional()
  }).strict(), input, "navigation.openUrl");
  let url: URL;
  try { url = new URL(options.url); } catch (cause) {
    throw new VbdError("INVALID_URL", { operation: "navigation.openUrl", cause });
  }
  approvedOrigin(url.origin, options.allowedOrigins);
  if (url.protocol !== "https:" || url.username || url.password || url.hash ||
      options.url.includes("\\") || options.url.trim() !== options.url ||
      [...url.searchParams.keys()].some(key => !options.allowedQueryKeys.includes(key))) {
    throw new VbdError("INVALID_URL", { operation: "navigation.openUrl" });
  }
  call(sdkRoot(["Navigation"]), "openUrl", url.href, {
    ...(options.width === undefined ? {} : { width: options.width }),
    ...(options.height === undefined ? {} : { height: options.height })
  });
  return { status: "requested" };
}
const dialogOptions = presentationSchema.omit({ mode: true });
export type DialogOptions = z.input<typeof dialogOptions>;
async function record(ref: EntityRef, input: DialogOptions & {
  formId?: string; tabName?: string; data?: Record<string, string | number | boolean>;
} = {}) {
  const options = parseInput(dialogOptions.extend({
    formId: guidSchema.optional(), tabName: z.string().min(1).max(256).optional(), data: defaultsSchema.optional()
  }), input, "dialogs.record");
  return openRecord(ref, { ...options, mode: "dialog" });
}
async function customPage(name: string, input: DialogOptions & { entityName?: string; recordId?: string } = {}) {
  const options = parseInput(dialogOptions.extend({
    entityName: logicalNameSchema.optional(), recordId: guidSchema.optional()
  }), input, "dialogs.customPage");
  return openCustomPage(name, { ...options, mode: "dialog" });
}
async function webResource(name: string, input: DialogOptions & { data?: string } = {}) {
  const options = parseInput(dialogOptions.extend({ data: z.string().max(262144).optional() }),
    input, "dialogs.webResource");
  return openWebResource(name, { ...options, mode: "dialog" });
}
async function alert(message: string, input: { title?: string; confirmButtonLabel?: string } = {}) {
  const options = parseInput(z.object({
    title: messageSchema.optional(), confirmButtonLabel: messageSchema.optional()
  }).strict(), input, "dialogs.alert");
  await callAsync(sdkRoot(["Navigation"]), "openAlertDialog", {
    text: parseInput(messageSchema, message, "dialogs.alert"), ...options
  });
  return { status: "acknowledged" as const };
}
async function confirm(message: string, input: { title?: string; confirmButtonLabel?: string; cancelButtonLabel?: string } = {}) {
  const options = parseInput(z.object({
    title: messageSchema.optional(), confirmButtonLabel: messageSchema.optional(), cancelButtonLabel: messageSchema.optional()
  }).strict(), input, "dialogs.confirm");
  const result = resultOf(z.object({ confirmed: z.boolean() }),
    await callAsync(sdkRoot(["Navigation"]), "openConfirmDialog", {
      text: parseInput(messageSchema, message, "dialogs.confirm"), ...options
    }));
  return { status: result.confirmed ? "confirmed" as const : "cancelled" as const };
}
async function error(input: unknown): Promise<{ status: "closed"; correlationId: string }> {
  const normalized = Diagnostics.normalizeError(input, { operation: "dialogs.error" });
  await callAsync(sdkRoot(["Navigation"]), "openErrorDialog", {
    message: messageForCode(normalized.code),
    details: `Code: ${normalized.code}\nOperation: ${normalized.operation}\nCorrelation: ${normalized.correlationId}`
  });
  return { status: "closed", correlationId: normalized.correlationId };
}
export const Navigation = Object.freeze({ openRecord, newRecord, quickCreate, openView, openDashboard, openCustomPage, openWebResource, openUrl });
export const Dialogs = Object.freeze({ record, customPage, webResource, alert, confirm, error });
