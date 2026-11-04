import { z } from "zod";
import { Launch } from "./launch.js";
import type { PreparationOptions, PreparedLaunch } from "./launch.js";
import { VbdError } from "./errors.js";
import { identifierSchema, parseInput } from "./validation.js";
import type { WindowOptions } from "./windows.js";
import { contextSchema } from "./platform.js";

const pending = new Map<string, { token?: PreparedLaunch }>();
export function commandIdentity(key: string) {
  const parts = parseInput(z.string().max(257), key, "commands.key").split("/");
  if (parts.length !== 2) throw new VbdError("INVALID_ARGUMENT", { operation: "commands.key" });
  return {
    configurationName: parseInput(identifierSchema, parts[0], "commands.key"),
    profileKey: parseInput(identifierSchema, parts[1], "commands.key")
  };
}
export async function prepareCommand(key: string, options: Omit<PreparationOptions, "configurationName" | "profileKey"> = {}) {
  const identity = commandIdentity(key), state: { token?: PreparedLaunch } = {};
  const settings = parseInput(z.object({
    context: contextSchema.optional(), ttlMs: z.number().int().min(1).max(300000).optional()
  }).strict(), options, "commands.prepare");
  if (!pending.has(key) && pending.size >= 128) {
    const oldest = pending.keys().next().value;
    if (oldest !== undefined) pending.delete(oldest);
  }
  pending.set(key, state);
  try {
    const token = await Launch.prepareProfile({ ...identity, ...settings });
    if (pending.get(key) !== state) return { status: "superseded" as const };
    state.token = token;
    return { status: "prepared" as const };
  } catch (error) {
    if (pending.get(key) !== state) return { status: "superseded" as const };
    pending.delete(key);
    throw error;
  }
}
export function runPreparedCommand(
  key: string, options: Pick<WindowOptions, "width" | "height" | "host"> = {}
) {
  commandIdentity(key);
  const token = pending.get(key)?.token;
  if (!token) throw new VbdError("CONFIG_NOT_READY", { operation: "commands.execute" });
  return Launch.openPrepared(token, options);
}
