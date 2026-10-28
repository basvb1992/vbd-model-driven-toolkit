import { z } from "zod";
import { attributeOf, controlOf } from "./forms.js";
import { entityRefSchema } from "./entity-reference.js";
import type { EntityRef } from "./entity-reference.js";
import { VbdError } from "./errors.js";
import { call, callAsync, nameSchema, requireMethod, resultOf, sdkRoot } from "./sdk.js";
import type { SdkObject } from "./sdk.js";
import { guidSchema, logicalNameSchema, parseInput } from "./validation.js";
import { checkedXml } from "./xml.js";
import { disposeRegistration, registration } from "./registrations.js";
import type { Disposable } from "./registrations.js";
import { filterOptions, restoreOptions, setOptions } from "./choices-options.js";
export type {
  ChoiceBaselineToken, ChoiceMutationOptions, ChoiceMutationResult, ChoiceOption, ChoiceRestoreResult
} from "./choices-options.js";

const tableList = z.array(logicalNameSchema.transform(value => value.toLowerCase())).min(1).max(100)
  .refine(value => new Set(value).size === value.length);
const filterSchema = z.object({ filterXml: z.string().min(1), entityLogicalName: logicalNameSchema }).strict();
const pickOptions = z.object({
  entityTypes: tableList,
  allowMultiSelect: z.boolean().default(false),
  defaultEntityType: logicalNameSchema.optional(), defaultViewId: guidSchema.optional(),
  disableMru: z.boolean().default(true), searchText: z.string().max(8192).optional(),
  viewIds: z.array(guidSchema).max(100).optional(),
  filters: z.array(filterSchema).max(100).optional()
}).strict();
export type LookupPickOptions = z.input<typeof pickOptions>;
function filterXml(value: string): string {
  return checkedXml(value, "filter").xml.replace(/^\s*<\?xml[\s\S]*?\?>\s*/, "");
}
async function pick(input: LookupPickOptions): Promise<
  { status: "cancelled"; records: [] } | { status: "selected"; records: EntityRef[] }
> {
  const options = parseInput(pickOptions, input, "lookups.pick");
  if (options.defaultEntityType && !options.entityTypes.includes(options.defaultEntityType.toLowerCase())) {
    throw new VbdError("INVALID_ARGUMENT", { operation: "lookups.pick" });
  }
  const filters = options.filters?.map(filter => {
    if (!options.entityTypes.includes(filter.entityLogicalName.toLowerCase())) {
      throw new VbdError("INVALID_ARGUMENT", { operation: "lookups.pick" });
    }
    return { ...filter, entityLogicalName: filter.entityLogicalName.toLowerCase(), filterXml: filterXml(filter.filterXml) };
  });
  const result = await callAsync(sdkRoot(["Utility"]), "lookupObjects", {
    ...options,
    ...(options.defaultEntityType === undefined ? {} : { defaultEntityType: options.defaultEntityType.toLowerCase() }),
    ...(filters === undefined ? {} : { filters })
  });
  if (result === undefined) return { status: "cancelled", records: [] };
  const records = resultOf(z.array(entityRefSchema).max(1000), result);
  if ((!options.allowMultiSelect && records.length > 1) ||
      records.some(ref => !options.entityTypes.includes(ref.entityType)) ||
      new Set(records.map(ref => `${ref.entityType}:${ref.id}`)).size !== records.length) {
    throw new VbdError("DATA_RESPONSE_INVALID", { operation: "lookups.pick" });
  }
  return records.length === 0 ? { status: "cancelled", records: [] } : { status: "selected", records };
}
const filtersByControl = new WeakMap<SdkObject, Map<string, Disposable>>();
function addFilter(input: unknown, controlName: string, xml: string, entityLogicalName?: string): Disposable {
  parseInput(nameSchema, controlName, "lookups.addFilter");
  const filter = filterXml(xml);
  if (entityLogicalName !== undefined) parseInput(logicalNameSchema, entityLogicalName, "lookups.addFilter");
  const control = controlOf(input, controlName);
  requireMethod(control, "addPreSearch");
  requireMethod(control, "removePreSearch");
  requireMethod(control, "addCustomFilter");
  let entries = filtersByControl.get(control);
  if (!entries) { entries = new Map(); filtersByControl.set(control, entries); }
  const key = JSON.stringify([filter, entityLogicalName ?? null]);
  const existing = entries.get(key);
  if (existing) return existing;
  if (entries.size >= 100) throw new VbdError("LIMIT_EXCEEDED", { operation: "lookups.addFilter" });
  const handler = () => {
    call(control, "addCustomFilter", filter, ...(entityLogicalName === undefined ? [] : [entityLogicalName]));
  };
  call(control, "addPreSearch", handler);
  const currentEntries = entries;
  const token = registration("lookup", () => {
    call(control, "removePreSearch", handler);
    currentEntries.delete(key);
  });
  entries.set(key, token);
  return token;
}
function removeFilter(token: Disposable) { return disposeRegistration(token, "lookup"); }
function setDefaultView(input: unknown, controlName: string, viewId: string) {
  const id = parseInput(guidSchema, viewId, "lookups.setDefaultView");
  call(controlOf(input, controlName), "setDefaultView", id);
  return { requested: true };
}
function setEntityTypes(input: unknown, controlName: string, entities: readonly string[]) {
  const types = parseInput(tableList, entities, "lookups.setEntityTypes");
  call(controlOf(input, controlName), "setEntityTypes", types);
  return { requested: true };
}
function getOptions(input: unknown, column: string): { value: number; text: string }[] {
  const attribute = attributeOf(input, column);
  const type = resultOf(z.string(), call(attribute, "getAttributeType"));
  if (type !== "optionset" && type !== "multiselectoptionset") {
    throw new VbdError("FIELD_TYPE_MISMATCH", { operation: "choices.getOptions" });
  }
  return resultOf(z.array(z.object({ value: z.number().int(), text: z.string().max(8192) })).max(1000),
    call(attribute, "getOptions"));
}
export const Lookups = Object.freeze({ pick, addFilter, removeFilter, setDefaultView, setEntityTypes });
export const Choices = Object.freeze({ getOptions, setOptions, filterOptions, restoreOptions });
