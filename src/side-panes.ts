import { z } from "zod";
import { Context } from "./context.js";
import { entityRefSchema } from "./entity-reference.js";
import { VbdError } from "./errors.js";
import { call, callAsync, hasMethod, nameSchema, sdkObject, sdkRoot } from "./sdk.js";
import type { SdkObject } from "./sdk.js";
import { guidSchema, identifierSchema, isRecord, logicalNameSchema, parseInput } from "./validation.js";

const paneOptions = z.object({
  paneId: identifierSchema, title: nameSchema,
  width: z.number().int().min(300).max(1600).default(400),
  canClose: z.boolean().default(true), hideHeader: z.boolean().default(false),
  isSelected: z.boolean().default(false)
}).strict();
export type SidePaneOptions = z.input<typeof paneOptions>;
export interface SidePaneHandle { readonly paneId: string }
const pageSchema = z.discriminatedUnion("pageType", [
  z.object({
    pageType: z.literal("entityrecord"), entityName: logicalNameSchema,
    entityId: guidSchema, formId: guidSchema.optional()
  }).strict(),
  z.object({
    pageType: z.literal("custom"), name: logicalNameSchema,
    entityName: logicalNameSchema.optional(), recordId: guidSchema.optional()
  }).strict().refine(value => !value.recordId || value.entityName !== undefined),
  z.object({
    pageType: z.literal("webresource"),
    webresourceName: z.string().min(1).max(256)
      .regex(/^[A-Za-z0-9_][A-Za-z0-9_./-]*\.html?$/i)
      .refine(value => value.split("/").every(part => part && part !== "." && part !== "..")),
    data: z.string().max(262144).optional()
  }).strict()
]);
export type SidePanePage = z.input<typeof pageSchema>;
interface State {
  token: SidePaneHandle;
  options: z.output<typeof paneOptions>;
  pane: SdkObject | undefined;
  pending: Promise<SidePaneHandle> | undefined;
  busy: boolean;
}
const hosts = new WeakMap<SdkObject, Map<string, State>>();
function manager(): SdkObject {
  const client = Context.getClient();
  if (client.client !== "Web" || client.state !== "Online" || client.formFactor !== 1) {
    throw new VbdError("UNSUPPORTED_SURFACE", { operation: "sidePanes.client" });
  }
  const host = sdkRoot(["App", "sidePanes"]);
  if (!hasMethod(host, "getPane")) {
    throw new VbdError("UNSUPPORTED_SURFACE", { operation: "sidePanes.host" });
  }
  return host;
}
function states(host: SdkObject): Map<string, State> {
  let owned = hosts.get(host);
  if (!owned) { owned = new Map(); hosts.set(host, owned); }
  return owned;
}
function current(host: SdkObject, state: State): SdkObject {
  if (manager() !== host || states(host).get(state.options.paneId) !== state ||
      call(host, "getPane", state.options.paneId) !== state.pane || !state.pane ||
      state.pane.paneId !== state.options.paneId) {
    throw new VbdError("RESOURCE_NOT_FOUND", { operation: "sidePanes.instance" });
  }
  return state.pane;
}
function matchingOptions(pane: SdkObject, options: z.output<typeof paneOptions>): void {
  for (const key of ["title", "width", "canClose"] as const) {
    if (pane[key] !== options[key]) {
      throw new VbdError("RESOURCE_CONFLICT", { operation: "sidePanes.options" });
    }
  }
}
function owned(target: string | SidePaneHandle): { host: SdkObject; state: State; pane: SdkObject } {
  const id = parseInput(identifierSchema, typeof target === "string" ? target :
    isRecord(target) ? target.paneId : undefined, "sidePanes.target");
  const host = manager(), state = states(host).get(id);
  if (!state || (typeof target !== "string" && target !== state.token)) {
    throw new VbdError("RESOURCE_NOT_FOUND", { operation: "sidePanes.target" });
  }
  if (state.pending || state.busy) throw new VbdError("RESOURCE_BUSY", { operation: "sidePanes.target" });
  return { host, state, pane: current(host, state) };
}
async function createOrGet(input: SidePaneOptions): Promise<SidePaneHandle> {
  const options = parseInput(paneOptions, input, "sidePanes.createOrGet");
  const host = manager(), entries = states(host);
  const previous = entries.get(options.paneId);
  if (previous?.busy) throw new VbdError("RESOURCE_BUSY", { operation: "sidePanes.createOrGet" });
  if (previous?.pending) {
    if (JSON.stringify(previous.options) !== JSON.stringify(options)) {
      throw new VbdError("RESOURCE_CONFLICT", { operation: "sidePanes.createOrGet" });
    }
    return previous.pending;
  }
  const native: unknown = call(host, "getPane", options.paneId);
  if (native !== undefined && native !== null) {
    if (!previous || JSON.stringify(previous.options) !== JSON.stringify(options)) {
      throw new VbdError("RESOURCE_CONFLICT", { operation: "sidePanes.createOrGet" });
    }
    matchingOptions(current(host, previous), options);
    return Promise.resolve(previous.token);
  }
  for (const [id, state] of entries) {
    if (!state.pending && call(host, "getPane", id) == null) entries.delete(id);
  }
  if (entries.size >= 32) throw new VbdError("LIMIT_EXCEEDED", { operation: "sidePanes.createOrGet" });
  const state: State = {
    token: Object.freeze({ paneId: options.paneId }), options: Object.freeze(options),
    pane: undefined, pending: undefined, busy: false
  };
  entries.set(options.paneId, state);
  const pending = Promise.resolve().then(async () => {
    try {
      if (manager() !== host) throw new VbdError("RESOURCE_NOT_FOUND", { operation: "sidePanes.createOrGet" });
      state.pane = sdkObject(await callAsync(host, "createPane", { ...options }));
      if (state.pane.paneId !== options.paneId ||
          !["navigate", "select", "close"].every(name => hasMethod(state.pane, name))) {
        throw new VbdError("DATA_RESPONSE_INVALID", { operation: "sidePanes.createOrGet" });
      }
      matchingOptions(current(host, state), options);
      state.pending = undefined;
      return state.token;
    } catch (cause) {
      if (entries.get(options.paneId) === state) entries.delete(options.paneId);
      throw cause;
    }
  });
  state.pending = pending;
  return pending;
}
async function navigate(target: string | SidePaneHandle, input: SidePanePage): Promise<{
  status: "navigated"; paneId: string;
}> {
  const page = parseInput(pageSchema, input, "sidePanes.navigate");
  if (page.pageType === "entityrecord") {
    const ref = parseInput(entityRefSchema, { entityType: page.entityName, id: page.entityId }, "sidePanes.navigate");
    page.entityName = ref.entityType;
  }
  const { host, state, pane } = owned(target);
  state.busy = true;
  try {
    await callAsync(pane, "navigate", page);
    current(host, state);
    return { status: "navigated", paneId: state.token.paneId };
  } finally { state.busy = false; }
}
function select(target: string | SidePaneHandle): { status: "requested"; paneId: string } {
  const { host, state, pane } = owned(target);
  state.busy = true;
  try {
    call(pane, "select");
    current(host, state);
    return { status: "requested", paneId: state.token.paneId };
  } finally { state.busy = false; }
}
function close(target: string | SidePaneHandle): { status: "closed"; paneId: string } {
  const { host, state, pane } = owned(target);
  state.busy = true;
  try {
    call(pane, "close");
    states(host).delete(state.token.paneId);
    return { status: "closed", paneId: state.token.paneId };
  } finally { state.busy = false; }
}
export const SidePanes = Object.freeze({ createOrGet, navigate, select, close });
