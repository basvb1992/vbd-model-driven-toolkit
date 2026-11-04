import { z } from "zod";
import { Context, formOf } from "./context.js";
import { call, requireMethod, sdkObject } from "./sdk.js";
import type { SdkObject } from "./sdk.js";
import { attributeOf } from "./forms.js";
import { VbdError } from "./errors.js";
import { logicalNameSchema, parseInput } from "./validation.js";
import { prepareCommand } from "./command-state.js";
import { presentFailure } from "./commands.js";
import { disposeRegistration, registration } from "./registrations.js";
import type { Disposable } from "./registrations.js";
import { Validation } from "./form-validation.js";
import type { ValidationRule } from "./form-validation.js";
import type { PreparationOptions } from "./launch.js";

async function onLoad(
  executionContext: unknown, commandKey: string,
  options: Omit<PreparationOptions, "configurationName" | "profileKey"> = {}
) {
  try {
    Context.fromFormEvent(executionContext);
    return await prepareCommand(commandKey, options);
  } catch (error) { return presentFailure(error); }
}
async function onChange(
  executionContext: unknown, commandKey: string,
  options: Omit<PreparationOptions, "configurationName" | "profileKey"> = {}
) {
  return onLoad(executionContext, commandKey, options);
}
function onSave(executionContext: unknown, rules: readonly ValidationRule[] | string,
  options: { notificationId?: string } = {}) {
  return Validation.validateBeforeSave(executionContext, rules, options);
}
export type EventHandler = (executionContext: unknown) => unknown;
const registrations = new WeakMap<SdkObject, Map<string, Map<EventHandler, Disposable>>>();
function register(
  input: unknown,
  settings: { event: "change" | "load" | "save"; column?: string },
  handler: EventHandler
): Disposable {
  const options = parseInput(z.object({
    event: z.enum(["change", "load", "save"]), column: logicalNameSchema.optional()
  }).strict(), settings, "events.register");
  if (typeof handler !== "function" || ((options.event === "change") !== (options.column !== undefined))) {
    throw new VbdError("INVALID_ARGUMENT", { operation: "events.register" });
  }
  const form = formOf(input);
  const target = options.event === "change" && options.column !== undefined
    ? attributeOf(form, options.column)
    : options.event === "save" ? sdkObject(sdkObject(form.data).entity) : sdkObject(form.data);
  const add = options.event === "change" ? "addOnChange" : options.event === "save" ? "addOnSave" : "addOnLoad";
  const remove = options.event === "change" ? "removeOnChange" : options.event === "save" ? "removeOnSave" : "removeOnLoad";
  requireMethod(target, add);
  requireMethod(target, remove);
  let events = registrations.get(target);
  if (!events) { events = new Map(); registrations.set(target, events); }
  let handlers = events.get(options.event);
  if (!handlers) { handlers = new Map(); events.set(options.event, handlers); }
  const existing = handlers.get(handler);
  if (existing) return existing;
  if (handlers.size >= 100) throw new VbdError("LIMIT_EXCEEDED", { operation: "events.register" });
  call(target, add, handler);
  const current = handlers;
  const token = registration("event", () => {
    call(target, remove, handler);
    current.delete(handler);
  });
  handlers.set(handler, token);
  return token;
}
function unregister(token: Disposable) { return disposeRegistration(token, "event"); }
export const Events = Object.freeze({ onLoad, onChange, onSave, register, unregister });
