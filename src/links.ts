import { z } from "zod";
import { VbdError } from "./errors.js";
import { entityRefSchema } from "./entity-reference.js";
import { environmentRoot, guidSchema, logicalNameSchema, parseInput } from "./validation.js";

const linkOptions = z.object({
  environmentUrl: z.string(),
  appId: z.string().optional(),
  appName: logicalNameSchema.optional(),
  allowedOrigins: z.array(z.string()).min(1).max(20)
}).strict();
export type AppLinkOptions = z.input<typeof linkOptions>;
const recordLinkOptions = linkOptions.extend({
  record: entityRefSchema, formId: guidSchema.optional()
});
const viewLinkOptions = linkOptions.extend({
  entityName: logicalNameSchema, viewId: guidSchema,
  viewType: z.enum(["savedquery", "userquery"])
});
export type RecordLinkOptions = z.input<typeof recordLinkOptions>;
export type ViewLinkOptions = z.input<typeof viewLinkOptions>;

export function approvedOrigin(value: string, allowedOrigins: readonly string[]): string {
  const origin = environmentRoot(value).origin;
  if (!allowedOrigins.map((entry) => environmentRoot(entry).origin).includes(origin)) {
    throw new VbdError("INVALID_URL", { operation: "links.app" });
  }
  return origin;
}

function app(input: AppLinkOptions): string {
  const options = parseInput(linkOptions, input, "links.app");
  if ((options.appId === undefined) === (options.appName === undefined)) {
    throw new VbdError("INVALID_ARGUMENT", { operation: "links.app" });
  }
  const origin = approvedOrigin(options.environmentUrl, options.allowedOrigins);
  const url = new URL("/main.aspx", origin);
  if (options.appId !== undefined) {
    url.searchParams.set("appid", parseInput(guidSchema, options.appId, "links.app"));
  } else if (options.appName !== undefined) {
    url.searchParams.set("appname", options.appName);
  }
  return url.href;
}

export function validateAppUrl(value: string, allowedOrigins: readonly string[]): string {
  let url: URL;
  try {
    if (value.includes("\\") || value.trim() !== value) {
      throw new Error("Noncanonical URL.");
    }
    url = new URL(value);
  } catch (cause) {
    throw new VbdError("INVALID_URL", { operation: "windows.open", cause });
  }
  const origin = approvedOrigin(url.origin, allowedOrigins);
  const keys = [...url.searchParams.keys()];
  if (url.protocol !== "https:" || url.username || url.password || url.hash ||
      url.pathname !== "/main.aspx" || keys.length !== 1) {
    throw new VbdError("INVALID_URL", { operation: "windows.open" });
  }
  const key = keys[0];
  if (key !== "appid" && key !== "appname") {
    throw new VbdError("INVALID_URL", { operation: "windows.open" });
  }
  return app({
    environmentUrl: origin,
    allowedOrigins: [...allowedOrigins],
    ...(key === "appid" ? { appId: url.searchParams.get(key) ?? "" } : { appName: url.searchParams.get(key) ?? "" })
  });
}

function destination(options: AppLinkOptions): URL {
  return new URL(app({
    environmentUrl: options.environmentUrl, allowedOrigins: options.allowedOrigins,
    ...(options.appId === undefined ? {} : { appId: options.appId }),
    ...(options.appName === undefined ? {} : { appName: options.appName })
  }));
}
function record(input: RecordLinkOptions): string {
  const options = parseInput(recordLinkOptions, input, "links.record");
  const url = destination(options);
  url.searchParams.set("pagetype", "entityrecord");
  url.searchParams.set("etn", options.record.entityType);
  url.searchParams.set("id", `{${options.record.id}}`);
  if (options.formId !== undefined) {
    url.searchParams.set("extraqs", new URLSearchParams({ formid: options.formId }).toString());
  }
  return url.href;
}
function view(input: ViewLinkOptions): string {
  const options = parseInput(viewLinkOptions, input, "links.view");
  const url = destination(options);
  url.searchParams.set("pagetype", "entitylist");
  url.searchParams.set("etn", options.entityName.toLowerCase());
  url.searchParams.set("viewid", `{${options.viewId}}`);
  url.searchParams.set("viewtype", options.viewType === "savedquery" ? "1039" : "4230");
  return url.href;
}
export const Links = Object.freeze({ app, record, view });
