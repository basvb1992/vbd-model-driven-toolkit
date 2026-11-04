import { z } from "zod";
import { Diagnostics } from "./diagnostics.js";
import { VbdError } from "./errors.js";
import { call, callAsync, messageSchema, resultOf, sdkRoot } from "./sdk.js";
import { guidSchema, parseInput } from "./validation.js";

export interface ProgressToken { readonly id: string }
export interface NotificationToken { readonly id: string }
const progress = new Map<ProgressToken, string>();
const knownProgress = new WeakSet<ProgressToken>();
const notifications = new WeakMap<NotificationToken, { active: boolean; id: string }>();

function showProgress(message: string): ProgressToken {
  parseInput(messageSchema, message, "ui.showProgress");
  if (progress.size >= 128) throw new VbdError("LIMIT_EXCEEDED", { operation: "ui.showProgress" });
  call(sdkRoot(["Utility"]), "showProgressIndicator", message);
  const token = Object.freeze({ id: crypto.randomUUID() });
  progress.set(token, message);
  knownProgress.add(token);
  return token;
}
function hideProgress(token: ProgressToken): { removed: boolean } {
  if (!knownProgress.has(token)) throw new VbdError("INVALID_ARGUMENT", { operation: "ui.hideProgress" });
  if (!progress.has(token)) return { removed: false };
  const entries = [...progress.entries()];
  const current = entries[entries.length - 1]?.[0];
  if (current === token) {
    const previous = entries[entries.length - 2]?.[1];
    if (previous === undefined) call(sdkRoot(["Utility"]), "closeProgressIndicator");
    else call(sdkRoot(["Utility"]), "showProgressIndicator", previous);
  }
  progress.delete(token);
  return { removed: true };
}
async function withProgress<T>(message: string, operation: () => T | Promise<T>): Promise<T> {
  if (typeof operation !== "function") throw new VbdError("INVALID_ARGUMENT", { operation: "ui.withProgress" });
  const token = showProgress(message);
  const settled = await Promise.resolve().then(operation).then(
    value => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error })
  );
  try { hideProgress(token); }
  catch (cleanup) {
    throw new VbdError("PARTIAL_FAILURE", {
      operation: "ui.withProgress", cause: { token, ...(settled.ok ? {} : { error: settled.error }), cleanup }
    });
  }
  if (!settled.ok) throw Diagnostics.normalizeError(settled.error, { operation: "ui.withProgress" });
  return settled.value;
}
async function notify(message: string, input: {
  level?: "success" | "error" | "warning" | "info"; showCloseButton?: boolean;
} = {}): Promise<NotificationToken> {
  const options = parseInput(z.object({
    level: z.enum(["success", "error", "warning", "info"]).default("info"),
    showCloseButton: z.boolean().default(true)
  }).strict(), input, "ui.notify");
  const levels = { success: 1, error: 2, warning: 3, info: 4 };
  const id = resultOf(guidSchema, await callAsync(sdkRoot(["App"]), "addGlobalNotification", {
    type: 2, level: levels[options.level],
    message: parseInput(messageSchema, message, "ui.notify"), showCloseButton: options.showCloseButton
  }));
  const token = Object.freeze({ id });
  notifications.set(token, { active: true, id });
  return token;
}
async function clearNotification(token: NotificationToken): Promise<{ removed: boolean }> {
  const state = notifications.get(token);
  if (!state) throw new VbdError("INVALID_ARGUMENT", { operation: "ui.clearNotification" });
  if (!state.active) return { removed: false };
  await callAsync(sdkRoot(["App"]), "clearGlobalNotification", state.id);
  state.active = false;
  return { removed: true };
}
export const UI = Object.freeze({ showProgress, hideProgress, withProgress, notify, clearNotification });
