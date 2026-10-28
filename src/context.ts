import { z } from "zod";
import { entityReference } from "./entity-reference.js";
import type { EntityRef } from "./entity-reference.js";
import { VbdError } from "./errors.js";
import { call, callAsync, collectionItems, formTypeSchema, globalContext, hasMethod, resultOf, sdkObject, sdkRoot } from "./sdk.js";
import type { SdkObject } from "./sdk.js";
import { guidSchema, isRecord, logicalNameSchema, parseInput } from "./validation.js";

export interface OperationContext {
  readonly surface: "formEvent" | "formCommand" | "gridCommand";
  readonly form?: SdkObject;
  readonly grid?: SdkObject;
  readonly eventArgs?: unknown;
  readonly selection: readonly EntityRef[];
}
const contexts = new WeakSet<object>();

export function formOf(input: unknown): SdkObject {
  const value = isRecord(input) && contexts.has(input) ? input.form : input;
  const form = sdkObject(value);
  if (!hasMethod(form, "getAttribute") || !hasMethod(form, "getControl") ||
      !isRecord(form.data) || !isRecord(form.data.entity) || !isRecord(form.ui)) {
    throw new VbdError("UNSUPPORTED_SURFACE", { operation: "context.form" });
  }
  return form;
}
export function gridOf(input: unknown): SdkObject {
  const value = isRecord(input) && contexts.has(input) ? input.grid : input;
  const grid = sdkObject(value);
  if (!hasMethod(grid, "getGrid")) {
    throw new VbdError("UNSUPPORTED_SURFACE", { operation: "context.grid" });
  }
  return grid;
}
function make(input: OperationContext): OperationContext {
  const value = Object.freeze({ ...input, selection: Object.freeze(input.selection.map(ref => Object.freeze({ ...ref }))) });
  contexts.add(value);
  return value;
}
export function gridSelection(input: unknown): EntityRef[] {
  const grid = call(gridOf(input), "getGrid");
  return collectionItems(call(grid, "getSelectedRows")).map(row => {
    const data = sdkObject(sdkObject(row).data);
    return entityReference({
      entityType: call(data.entity, "getEntityName"),
      id: call(data.entity, "getId")
    });
  });
}
function fromFormEvent(executionContext: unknown): OperationContext {
  const form = formOf(call(executionContext, "getFormContext"));
  const args = hasMethod(executionContext, "getEventArgs") ? call(executionContext, "getEventArgs") : undefined;
  return make({ surface: "formEvent", form, eventArgs: args, selection: [] });
}
function fromFormCommand(primaryControl: unknown): OperationContext {
  return make({ surface: "formCommand", form: formOf(primaryControl), selection: [] });
}
function fromGridCommand(
  selectedControl: unknown, selectedReferences?: readonly unknown[], entityType?: string
): OperationContext {
  const grid = gridOf(selectedControl);
  let selection: EntityRef[];
  if (selectedReferences === undefined) {
    selection = gridSelection(grid);
  } else {
    parseInput(z.array(z.unknown()).max(1000), selectedReferences, "context.selection");
    selection = selectedReferences.map(value => {
      if (typeof value === "string") {
        return entityReference({
          entityType: entityType ?? call(grid, "getEntityName"), id: value
        });
      }
      if (!isRecord(value)) throw new VbdError("INVALID_ARGUMENT", { operation: "context.selection" });
      if ((value.id !== undefined && value.Id !== undefined) ||
          (value.entityType !== undefined && value.TypeName !== undefined)) {
        throw new VbdError("INVALID_ARGUMENT", { operation: "context.selection" });
      }
      const name = value.name ?? value.Name;
      return entityReference({
        entityType: value.entityType ?? value.TypeName, id: value.id ?? value.Id,
        ...(name === undefined || name === null ? {} : { name })
      });
    });
  }
  const keys = selection.map(ref => `${ref.entityType}:${ref.id}`);
  if (new Set(keys).size !== keys.length) throw new VbdError("INVALID_ARGUMENT", { operation: "context.selection" });
  return make({ surface: "gridCommand", grid, selection });
}
function getSelection(context: OperationContext): EntityRef[] {
  if (!contexts.has(context)) throw new VbdError("INVALID_ARGUMENT", { operation: "context.selection" });
  return context.selection.map(ref => ({ ...ref }));
}
function getRecord(context: OperationContext):
  | { state: "saved"; record: EntityRef }
  | { state: "unsaved"; entityType: string }
  | { state: "none" } {
  if (!contexts.has(context)) throw new VbdError("INVALID_ARGUMENT", { operation: "context.record" });
  if (context.surface === "gridCommand") {
    const ref = context.selection.length === 1 ? context.selection[0] : undefined;
    return ref ? { state: "saved", record: { ...ref } } : { state: "none" };
  }
  const form = formOf(context), entity = sdkObject(sdkObject(form.data).entity);
  const type = resultOf(formTypeSchema, call(form.ui, "getFormType"));
  if (type === 0 || type === 6) return { state: "none" };
  const entityType = resultOf(logicalNameSchema, call(entity, "getEntityName"));
  if (type === 1) return { state: "unsaved", entityType };
  const id = resultOf(z.string(), call(entity, "getId"));
  if (id === "" || id === "{}") return { state: "unsaved", entityType };
  return { state: "saved", record: entityReference({ entityType, id }) };
}
function requireSavedRecord(context: OperationContext): EntityRef {
  const state = getRecord(context);
  if (state.state !== "saved") throw new VbdError("UNSAVED_RECORD", { operation: "context.requireSavedRecord" });
  return state.record;
}
function getClient(): { client: string; state: "Online" | "Offline"; formFactor: number } {
  const client = globalContext().client;
  return {
    client: resultOf(z.string().min(1), call(client, "getClient")),
    state: resultOf(z.enum(["Online", "Offline"]), call(client, "getClientState")),
    formFactor: resultOf(z.number().int().min(1).max(3), call(client, "getFormFactor"))
  };
}
async function getApp(): Promise<{ appId: string; uniqueName?: string; displayName?: string }> {
  const result = resultOf(z.object({
    appId: guidSchema, uniqueName: z.string().optional(), displayName: z.string().optional()
  }), await callAsync(globalContext(), "getCurrentAppProperties"));
  return {
    appId: result.appId,
    ...(result.uniqueName === undefined ? {} : { uniqueName: result.uniqueName }),
    ...(result.displayName === undefined ? {} : { displayName: result.displayName })
  };
}
function getUser(): { userId: string; languageId: number; rolesAvailable: boolean; roleIds: string[] } {
  const user = sdkObject(globalContext().userSettings);
  const roleIds = user.roles === undefined ? undefined : collectionItems(user.roles).map(role =>
    resultOf(guidSchema, sdkObject(role).id));
  return {
    userId: resultOf(guidSchema, user.userId),
    languageId: resultOf(z.number().int().min(1).max(65535), user.languageId),
    rolesAvailable: roleIds !== undefined, roleIds: roleIds ?? []
  };
}
function requireCapability(
  context: OperationContext,
  capability: "form" | "grid" | "navigation" | "lookup" | "sidePane" | "online" | "window"
): { available: true } {
  if (!contexts.has(context)) throw new VbdError("INVALID_ARGUMENT", { operation: "context.capability" });
  parseInput(z.enum(["form", "grid", "navigation", "lookup", "sidePane", "online", "window"]), capability, "context.capability");
  let available: boolean;
  switch (capability) {
    case "form": available = context.form !== undefined; break;
    case "grid": available = context.grid !== undefined; break;
    case "online": available = getClient().state === "Online"; break;
    case "navigation": available = hasMethod(sdkRoot(["Navigation"]), "navigateTo"); break;
    case "lookup": available = hasMethod(sdkRoot(["Utility"]), "lookupObjects"); break;
    case "sidePane": available = hasMethod(sdkRoot(["App"]).sidePanes, "createPane"); break;
    case "window": available = typeof Reflect.get(globalThis, "open") === "function"; break;
  }
  if (!available) throw new VbdError("UNSUPPORTED_SURFACE", { operation: "context.capability" });
  return { available: true };
}
export const Context = Object.freeze({
  fromFormEvent, fromFormCommand, fromGridCommand, getRecord, getSelection,
  getClient, getApp, getUser, requireSavedRecord, requireCapability
});
