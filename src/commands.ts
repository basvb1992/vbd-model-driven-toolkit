import { z } from "zod";
import { Context, formOf, gridOf, gridSelection } from "./context.js";
import type { OperationContext } from "./context.js";
import { Navigation, Dialogs } from "./navigation.js";
import type { PresentationOptions } from "./navigation.js";
import { Diagnostics } from "./diagnostics.js";
import { VbdError } from "./errors.js";
import { entityRefSchema } from "./entity-reference.js";
import type { EntityRef } from "./entity-reference.js";
import { runPreparedCommand } from "./command-state.js";
import { call } from "./sdk.js";
import { logicalNameSchema, parseInput } from "./validation.js";
import type { WindowOptions } from "./windows.js";

export interface FailureOutcome { status: "failed"; error: VbdError }
export async function presentFailure(error: unknown): Promise<FailureOutcome> {
  const normalized = Diagnostics.normalizeError(error, { operation: "commands.execute" });
  try { await Dialogs.error(normalized); }
  catch (presentation) {
    throw new VbdError("ERROR_PRESENTATION_FAILED", {
      operation: "commands.error", cause: { error: normalized, presentation }
    });
  }
  return { status: "failed", error: normalized };
}
function execute(context: OperationContext, key: string, options: Pick<WindowOptions, "width" | "height" | "host"> = {}) {
  Context.getSelection(context);
  return runPreparedCommand(key, options);
}
async function run(primaryControl: unknown, key: string) {
  try { return execute(Context.fromFormCommand(primaryControl), key); }
  catch (error) { return presentFailure(error); }
}
async function runGrid(
  selectedControl: unknown, selectedReferences: readonly unknown[] | undefined, key: string, entityType?: string
) {
  try { return execute(Context.fromGridCommand(selectedControl, selectedReferences, entityType), key); }
  catch (error) { return presentFailure(error); }
}
function refresh(context: OperationContext, all = false) {
  Context.getSelection(context);
  parseInput(z.boolean(), all, "commands.refresh");
  if (context.surface === "gridCommand") call(gridOf(context), "refreshRibbon");
  else call(formOf(context).ui, "refreshRibbon", all);
  return { requested: true };
}
const selectionOptions = z.object({
  min: z.number().int().min(0).max(1000).default(1),
  max: z.number().int().min(0).max(1000).default(1000),
  entityType: logicalNameSchema.optional(),
  allowMixedTables: z.boolean().default(false)
}).strict();
function validateSelection(refs: readonly EntityRef[], input: z.input<typeof selectionOptions> = {}) {
  const options = parseInput(selectionOptions, input, "commands.validateSelection");
  if (options.min > options.max) throw new VbdError("INVALID_ARGUMENT", { operation: "commands.validateSelection" });
  const selected = parseInput(z.array(entityRefSchema).max(1000), refs, "commands.validateSelection");
  const issues: string[] = [];
  if (selected.length < options.min) issues.push("tooFew");
  if (selected.length > options.max) issues.push("tooMany");
  if (!options.allowMixedTables && new Set(selected.map(ref => ref.entityType)).size > 1) issues.push("mixedTables");
  const entityType = options.entityType?.toLowerCase();
  if (entityType && selected.some(ref => ref.entityType !== entityType)) issues.push("wrongTable");
  if (new Set(selected.map(ref => `${ref.entityType}:${ref.id}`)).size !== selected.length) issues.push("duplicate");
  return { valid: issues.length === 0, issues };
}
function getSelected(input: unknown): EntityRef[] { return gridSelection(input); }
function refreshGrid(input: unknown) {
  call(gridOf(input), "refresh");
  return { requested: true };
}
async function openSelected(input: unknown, options: PresentationOptions = {}) {
  const refs = getSelected(input);
  if (!validateSelection(refs, { min: 1, max: 1 }).valid) {
    throw new VbdError("INVALID_ARGUMENT", { operation: "grids.openSelected" });
  }
  const ref = refs[0];
  if (!ref) throw new VbdError("DATA_RESPONSE_INVALID", { operation: "grids.openSelected" });
  return Navigation.openRecord(ref, options);
}
export const Commands = Object.freeze({ run, runGrid, execute, refresh, validateSelection });
export const Grids = Object.freeze({ getSelected, refresh: refreshGrid, openSelected });
