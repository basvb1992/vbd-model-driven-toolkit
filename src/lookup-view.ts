import { z } from "zod";
import { formOf } from "./context.js";
import {
  boundedXml, lookupError, lookupTarget, nativeVoid, viewFetchSchema, viewLayoutSchema
} from "./lookup-common.js";
import { call, nameSchema, requireMethod, resultOf } from "./sdk.js";
import type { SdkObject } from "./sdk.js";
import { guidSchema, logicalNameSchema, parseInput } from "./validation.js";

const optionsSchema = z.object({
  lookupKind: z.literal("standard"), ownerLookup: z.literal(false),
  identityPolicy: z.literal("caller-unique"),
  viewId: guidSchema, entityType: logicalNameSchema.transform(value => value.toLowerCase()),
  displayName: z.string().min(1).max(256).refine(value => value.trim().length > 0),
  tableTypeCode: z.number().int().min(1).max(2_147_483_647),
  primaryIdColumn: logicalNameSchema, primaryNameColumn: logicalNameSchema,
  fetchXml: z.string().min(1), layoutXml: z.string().min(1), isDefault: z.boolean()
}).strict();
export type LookupViewOptions = z.input<typeof optionsSchema>;
export interface LookupViewReceipt {
  readonly status: "requested" | "existing";
  readonly viewId: string;
  readonly entityType: string;
  readonly removable: false;
}
interface OwnedView { contract: string; form: SdkObject; attribute: SdkObject; uncertain?: unknown }
const views = new WeakMap<SdkObject, Map<string, OwnedView>>();

export function addView(input: unknown, controlName: string, settings: LookupViewOptions): LookupViewReceipt {
  parseInput(nameSchema, controlName, "lookups.addView");
  const options = parseInput(optionsSchema, settings, "lookups.addView");
  const fetch = parseInput(viewFetchSchema, boundedXml(options.fetchXml, "fetch").root, "lookups.addView.fetch");
  return applyView(input, controlName, options, fetch);
}

function applyView(
  input: unknown, controlName: string, options: z.output<typeof optionsSchema>,
  fetch: z.output<typeof viewFetchSchema>
): LookupViewReceipt {
  const layout = parseInput(viewLayoutSchema,
    boundedXml(`<fetch>${options.layoutXml}</fetch>`, "fetch").root, "lookups.addView.layout").grid;
  const fields = fetch.entity.attribute.map(field => field["@_name"]);
  const cells = layout.row.cell.map(cell => cell["@_name"]);
  const orders = fetch.entity.order?.map(order => order["@_attribute"]) ?? [];
  const filters = fetch.entity.filter?.condition.map(item => item["@_attribute"]) ?? [];
  if (options.primaryIdColumn === options.primaryNameColumn || fetch.entity["@_name"] !== options.entityType ||
      Number(layout["@_object"]) !== options.tableTypeCode || layout.row["@_id"] !== options.primaryIdColumn ||
      layout["@_jump"] !== options.primaryNameColumn || !fields.includes(options.primaryIdColumn) ||
      !cells.includes(options.primaryNameColumn) || new Set(fields).size !== fields.length ||
      new Set(cells).size !== cells.length || new Set(orders).size !== orders.length ||
      [...cells, ...orders, ...filters].some(field => !fields.includes(field)) ||
      layout.row.cell.reduce((sum, cell) => sum + Number(cell["@_width"]), 0) > 10_000) {
    throw lookupError("INVALID_ARGUMENT", "lookups.addView.contract");
  }
  const form = formOf(input), target = lookupTarget(form, controlName, options.entityType);
  const add = requireMethod(target.control, "addCustomView");
  const defaultId = resultOf(guidSchema, call(target.control, "getDefaultView"));
  let owned = views.get(target.control);
  if (!owned) { owned = new Map(); views.set(target.control, owned); }
  const contract = JSON.stringify(options);
  const existing = owned.get(options.viewId);
  if (existing && (existing.form !== form || existing.attribute !== target.attribute)) {
    throw lookupError("CONFIG_EXPIRED", "lookups.addView");
  }
  if (existing?.uncertain !== undefined) throw lookupError("MUTATION_OUTCOME_UNKNOWN", "lookups.addView", existing.uncertain);
  if (existing && existing.contract !== contract) throw lookupError("RESOURCE_CONFLICT", "lookups.addView");
  if (!existing && defaultId === options.viewId) throw lookupError("RESOURCE_CONFLICT", "lookups.addView");
  if (!existing && owned.size >= 32) throw lookupError("LIMIT_EXCEEDED", "lookups.addView");
  if (!existing) {
    // Reserve identity before native dispatch: reentry/uncertain completion cannot cause a retry.
    const now = lookupTarget(form, controlName, options.entityType);
    if (now.control !== target.control || now.attribute !== target.attribute) {
      throw lookupError("CONFIG_EXPIRED", "lookups.addView");
    }
    const slot: OwnedView = { contract, form, attribute: target.attribute, uncertain: { reason: "dispatching" } };
    owned.set(options.viewId, slot);
    try {
      nativeVoid(add(options.viewId, options.entityType, options.displayName, options.fetchXml, options.layoutXml, options.isDefault));
      delete slot.uncertain;
    } catch (cause) {
      slot.uncertain = cause;
      throw lookupError("MUTATION_OUTCOME_UNKNOWN", "lookups.addView", cause);
    }
  }
  return Object.freeze({
    status: existing ? "existing" : "requested",
    viewId: options.viewId, entityType: options.entityType, removable: false
  });
}
