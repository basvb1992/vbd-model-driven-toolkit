import { z } from "zod";
import { formOf } from "./context.js";
import { entityReference } from "./entity-reference.js";
import type { EntityRef } from "./entity-reference.js";
import { VbdError } from "./errors.js";
import {
  call, callAsync, collectionItems, formTypeSchema, globalContext, hasMethod, messageSchema, nameSchema, partial,
  requireMethod, resultOf, sdkObject
} from "./sdk.js";
import type { SdkObject } from "./sdk.js";
import { guidSchema, logicalNameSchema, parseInput } from "./validation.js";
import { dateMilliseconds } from "./utils.js";

export type FieldKind = "text" | "number" | "boolean" | "date" | "lookup" | "choices";
export type FieldValue = string | number | boolean | Date | EntityRef[] | number[];
const writeOptions = z.object({
  fireOnChange: z.boolean().default(false),
  submitMode: z.enum(["dirty", "always", "never"]).optional()
}).strict();
export type FieldWriteOptions = z.input<typeof writeOptions>;
const dispatching = new WeakSet<object>();

export function attributeOf(input: unknown, column: string): SdkObject {
  parseInput(logicalNameSchema, column, "fields.attribute");
  const attribute = call(formOf(input), "getAttribute", column);
  if (attribute === null || attribute === undefined) {
    throw new VbdError("FORM_TARGET_MISSING", { operation: "fields.attribute", cause: { kind: "attribute", target: column } });
  }
  return sdkObject(attribute);
}
export function controlOf(input: unknown, name: string): SdkObject {
  parseInput(nameSchema, name, "controls.target");
  const control = call(formOf(input), "getControl", name);
  if (control === null || control === undefined) {
    throw new VbdError("FORM_TARGET_MISSING", { operation: "controls.target", cause: { kind: "control", target: name } });
  }
  return sdkObject(control);
}
function namesOf(input: string | readonly string[]): string[] {
  const names = parseInput(z.union([logicalNameSchema, z.array(logicalNameSchema).min(1).max(100)]),
    input, "fields.targets");
  const result = typeof names === "string" ? [names] : names;
  if (new Set(result).size !== result.length) throw new VbdError("INVALID_ARGUMENT", { operation: "fields.targets" });
  return result;
}
function kindOf(attribute: SdkObject): { kind: FieldKind; native: string } {
  const native = resultOf(z.string(), call(attribute, "getAttributeType"));
  switch (native) {
    case "string": case "memo": return { kind: "text", native };
    case "decimal": case "double": case "integer": case "money": case "optionset": return { kind: "number", native };
    case "boolean": return { kind: "boolean", native };
    case "datetime": return { kind: "date", native };
    case "lookup": return { kind: "lookup", native };
    case "multiselectoptionset": return { kind: "choices", native };
    default: throw new VbdError("UNSUPPORTED_SURFACE", { operation: "fields.type" });
  }
}
function normalizedValue(attribute: SdkObject, value: unknown, writing: boolean): FieldValue | null {
  const { kind, native } = kindOf(attribute);
  if (value === null) return null;
  let valid = true;
  switch (kind) {
    case "text":
      valid = typeof value === "string" && value.length <= 1_048_576;
      if (valid && typeof value === "string") {
        if (writing && hasMethod(attribute, "getMaxLength") &&
            value.length > resultOf(z.number().int().min(0), call(attribute, "getMaxLength"))) valid = false;
        if (valid) return value;
      }
      break;
    case "number":
      if (typeof value === "number" && Number.isFinite(value)) {
        valid = (native !== "integer" && native !== "optionset") || Number.isInteger(value);
        if (writing && hasMethod(attribute, "getMin") &&
            value < resultOf(z.number().finite(), call(attribute, "getMin"))) valid = false;
        if (writing && hasMethod(attribute, "getMax") &&
            value > resultOf(z.number().finite(), call(attribute, "getMax"))) valid = false;
        if (valid) return value;
      }
      break;
    case "boolean":
      if (typeof value === "boolean") return value;
      break;
    case "date": {
      const time = dateMilliseconds(value);
      if (time !== undefined) return new Date(time);
      break;
    }
    case "choices": {
      const result = z.array(z.number().int()).max(1000).safeParse(value);
      if (result.success && new Set(result.data).size === result.data.length) return [...result.data];
      break;
    }
    case "lookup": {
      if (!Array.isArray(value) || value.length > 1000) break;
      const refs = value.map(item => {
        const record = sdkObject(item);
        const ref = entityReference({
          entityType: record.entityType, id: record.id,
          ...(record.name === undefined ? {} : { name: record.name })
        });
        if (writing && (!ref.name || ref.name.trim().length === 0)) {
          throw new VbdError("FIELD_TYPE_MISMATCH", { operation: "fields.lookup" });
        }
        return ref;
      });
      if (new Set(refs.map(ref => `${ref.entityType}:${ref.id}`)).size !== refs.length) break;
      if (writing && refs.length > 1 &&
          resultOf(z.boolean(), call(attribute, "getIsPartyList")) !== true) break;
      if (writing && attribute.controls !== undefined) {
        for (const control of collectionItems(attribute.controls, 100)) {
          if (!hasMethod(control, "getEntityTypes")) continue;
          const targets = resultOf(z.array(logicalNameSchema).min(1).max(100), call(control, "getEntityTypes"));
          if (refs.some(ref => !targets.map(target => target.toLowerCase()).includes(ref.entityType))) {
            throw new VbdError("FIELD_TYPE_MISMATCH", { operation: "fields.lookup" });
          }
        }
      }
      return refs;
    }
  }
  throw new VbdError("FIELD_TYPE_MISMATCH", { operation: "fields.value" });
}
function get(input: unknown, column: string, type: "text"): string | null;
function get(input: unknown, column: string, type: "number"): number | null;
function get(input: unknown, column: string, type: "boolean"): boolean | null;
function get(input: unknown, column: string, type: "date"): Date | null;
function get(input: unknown, column: string, type: "lookup"): EntityRef[] | null;
function get(input: unknown, column: string, type: "choices"): number[] | null;
function get(input: unknown, column: string, type?: FieldKind): FieldValue | null;
function get(input: unknown, column: string, type?: FieldKind): FieldValue | null {
  const attribute = attributeOf(input, column), actual = kindOf(attribute).kind;
  if (type !== undefined) {
    parseInput(z.enum(["text", "number", "boolean", "date", "lookup", "choices"]), type, "fields.get");
    if (type !== actual) throw new VbdError("FIELD_TYPE_MISMATCH", { operation: "fields.get" });
  }
  return normalizedValue(attribute, call(attribute, "getValue"), false);
}
function fireOnChange(input: unknown, column: string): { dispatched: true } {
  const attribute = attributeOf(input, column);
  if (dispatching.has(attribute)) throw new VbdError("EVENT_REENTRY", { operation: "fields.fireOnChange" });
  dispatching.add(attribute);
  try { call(attribute, "fireOnChange"); }
  finally { dispatching.delete(attribute); }
  return { dispatched: true };
}
function prepareWrite(input: unknown, column: string, value: unknown, options: z.output<typeof writeOptions>) {
  const attribute = attributeOf(input, column), normalized = normalizedValue(attribute, value, true);
  requireMethod(attribute, "setValue");
  if (options.submitMode !== undefined) requireMethod(attribute, "setSubmitMode");
  if (options.fireOnChange) requireMethod(attribute, "fireOnChange");
  return () => {
    const native = Array.isArray(normalized) && kindOf(attribute).kind === "lookup"
      ? normalized.map(value => {
        const ref = entityReference(value);
        return { ...ref, id: `{${ref.id}}` };
      }) : normalized;
    const completed: string[] = [];
    try {
      call(attribute, "setValue", native);
      completed.push("setValue");
      if (options.submitMode !== undefined) {
        call(attribute, "setSubmitMode", options.submitMode); completed.push("setSubmitMode");
      }
      if (options.fireOnChange) fireOnChange(input, column);
    } catch (cause) {
      if (completed.length === 0) throw cause;
      throw new VbdError("PARTIAL_FAILURE", {
        operation: "fields.set", cause: { column, completed, cause }
      });
    }
    return { column, status: "applied" as const };
  };
}
function set(input: unknown, column: string, value: unknown, settings: FieldWriteOptions = {}) {
  const options = parseInput(writeOptions, settings, "fields.set");
  return prepareWrite(input, column, value, options)();
}
function clear(input: unknown, columns: string | readonly string[], settings: FieldWriteOptions = {}) {
  const options = parseInput(writeOptions, settings, "fields.clear");
  return partial(namesOf(columns).map(key => ({ key, run: prepareWrite(input, key, null, options) })));
}
function copy(input: unknown, mappings: readonly { from: string; to: string }[], settings: FieldWriteOptions & {
  overwrite?: boolean;
} = {}): { applied: string[]; skipped: string[] } {
  const options = parseInput(writeOptions.extend({ overwrite: z.boolean().default(false) }), settings, "fields.copy");
  const pairs = parseInput(z.array(z.object({ from: logicalNameSchema, to: logicalNameSchema }).strict()).min(1).max(100),
    mappings, "fields.copy");
  if (new Set(pairs.map(pair => pair.to)).size !== pairs.length) {
    throw new VbdError("INVALID_ARGUMENT", { operation: "fields.copy" });
  }
  const skipped: string[] = [];
  const pending = pairs.flatMap(pair => {
    const source = get(input, pair.from), existing = get(input, pair.to);
    const run = prepareWrite(input, pair.to, source, { fireOnChange: options.fireOnChange, submitMode: options.submitMode });
    if (!options.overwrite && existing !== null) { skipped.push(pair.to); return []; }
    return [{ key: pair.to, run }];
  });
  return { applied: partial(pending).map(item => item.column), skipped };
}
function setDefault(input: unknown, column: string, value: unknown, settings: FieldWriteOptions & {
  emptyString?: boolean;
} = {}) {
  const options = parseInput(writeOptions.extend({ emptyString: z.boolean().default(false) }), settings, "fields.setDefault");
  const existing = get(input, column);
  const run = prepareWrite(input, column, value, { fireOnChange: options.fireOnChange, submitMode: options.submitMode });
  if (existing !== null && !(options.emptyString && existing === "")) {
    return { column, status: "skipped" as const, reason: "existingValue" as const };
  }
  return run();
}
function setRequired(input: unknown, columns: string | readonly string[], level: "none" | "recommended" | "required") {
  parseInput(z.enum(["none", "recommended", "required"]), level, "fields.setRequired");
  const targets = namesOf(columns).map(column => ({ column, attribute: attributeOf(input, column) }));
  for (const item of targets) requireMethod(item.attribute, "setRequiredLevel");
  return partial(targets.map(item => ({
    key: item.column, run: () => { call(item.attribute, "setRequiredLevel", level); return { column: item.column }; }
  })));
}
function setSubmitMode(input: unknown, columns: string | readonly string[], mode: "dirty" | "always" | "never") {
  parseInput(z.enum(["dirty", "always", "never"]), mode, "fields.setSubmitMode");
  const targets = namesOf(columns).map(column => ({ column, attribute: attributeOf(input, column) }));
  for (const item of targets) requireMethod(item.attribute, "setSubmitMode");
  return partial(targets.map(item => ({
    key: item.column, run: () => { call(item.attribute, "setSubmitMode", mode); return { column: item.column }; }
  })));
}
function getLookup(input: unknown, column: string): EntityRef[] | null { return get(input, column, "lookup"); }
function setLookup(input: unknown, column: string, refs: readonly EntityRef[] | null, settings: FieldWriteOptions = {}) {
  if (kindOf(attributeOf(input, column)).kind !== "lookup") {
    throw new VbdError("FIELD_TYPE_MISMATCH", { operation: "fields.setLookup" });
  }
  return set(input, column, refs, settings);
}

function isDirty(input: unknown): boolean {
  return resultOf(z.boolean(), call(sdkObject(formOf(input).data), "getIsDirty"));
}
function getType(input: unknown): number {
  return resultOf(formTypeSchema, call(formOf(input).ui, "getFormType"));
}
const saving = new WeakSet<object>();
async function save(input: unknown, settings: { saveMode?: number } = {}): Promise<{ status: "saved" }> {
  const options = parseInput(z.object({
    saveMode: z.number().int().min(1).max(100).optional()
  }).strict(), settings, "forms.save");
  const form = formOf(input);
  if (saving.has(form)) throw new VbdError("EVENT_REENTRY", { operation: "forms.save" });
  saving.add(form);
  try { await callAsync(form.data, "save", options); }
  finally { saving.delete(form); }
  return { status: "saved" };
}
async function refresh(input: unknown, settings: { dirtyPolicy?: "reject" | "save" } = {}) {
  const options = parseInput(z.object({ dirtyPolicy: z.enum(["reject", "save"]).default("reject") }).strict(),
    settings, "forms.refresh");
  const form = formOf(input);
  if (isDirty(form)) {
    if (options.dirtyPolicy === "reject") throw new VbdError("DIRTY_FORM", { operation: "forms.refresh" });
    await save(form);
    if (isDirty(form)) throw new VbdError("DIRTY_FORM", { operation: "forms.refresh" });
  }
  await callAsync(form.data, "refresh", false);
  return { status: "refreshed" as const };
}
export interface FormSwitchOptions { dirtyPolicy?: "reject" | "save" }
export type FormSwitchResult = { status: "requested" | "alreadyCurrent"; formId: string };
const switching = new WeakSet<SdkObject>();
function switchSnapshot(form: SdkObject, targetId: string) {
  // A deliberately narrower subset than every main-form surface: desktop Web update forms.
  const client = globalContext().client;
  if (resultOf(z.string(), call(client, "getClient")) !== "Web" ||
      resultOf(z.number().int(), call(client, "getFormFactor")) !== 1 ||
      getType(form) !== 2) {
    throw new VbdError("UNSUPPORTED_SURFACE", { operation: "forms.switchForm" });
  }
  const data = sdkObject(form.data), entity = sdkObject(data.entity), ui = sdkObject(form.ui);
  const recordId = resultOf(z.string(), call(entity, "getId"));
  if (recordId === "" || recordId === "{}") {
    throw new VbdError("UNSAVED_RECORD", { operation: "forms.switchForm" });
  }
  const record = resultOf(guidSchema, recordId);
  const table = resultOf(logicalNameSchema, call(entity, "getEntityName")).toLowerCase();
  const selector = sdkObject(ui.formSelector);
  const items = selector.items;
  const forms = collectionItems(items, 100).map(sdkObject);
  const ids = forms.map(item => resultOf(guidSchema, call(item, "getId")));
  if (new Set(ids).size !== ids.length || new Set(forms).size !== forms.length) {
    throw new VbdError("DATA_RESPONSE_INVALID", { operation: "forms.switchForm" });
  }
  const current = call(selector, "getCurrentItem");
  if (current === null || current === undefined) {
    throw new VbdError("UNSUPPORTED_SURFACE", { operation: "forms.switchForm" });
  }
  const currentId = resultOf(guidSchema, call(current, "getId"));
  if (!forms.includes(sdkObject(current)) || ids[forms.indexOf(sdkObject(current))] !== currentId) {
    throw new VbdError("DATA_RESPONSE_INVALID", { operation: "forms.switchForm" });
  }
  const target = forms[ids.indexOf(targetId)];
  if (!target) throw new VbdError("FORM_TARGET_MISSING", { operation: "forms.switchForm" });
  const navigate = target.navigate;
  requireMethod(target, "navigate");
  requireMethod(data, "getIsDirty");
  const methods = [form.getControl, form.getAttribute, data.getIsDirty, data.save, entity.getId,
    entity.getEntityName, ui.getFormType, selector.getCurrentItem, sdkObject(items).get,
    sdkObject(current).getId, target.getId, navigate];
  return { data, entity, ui, selector, items, current, currentId, target, methods, record, table };
}
async function switchForm(input: unknown, formId: string, settings: FormSwitchOptions = {}): Promise<FormSwitchResult> {
  const id = parseInput(guidSchema, formId, "forms.switchForm");
  const options = parseInput(z.object({ dirtyPolicy: z.enum(["reject", "save"]).default("reject") }).strict(),
    settings, "forms.switchForm");
  const form = formOf(input);
  if (switching.has(form)) throw new VbdError("RESOURCE_BUSY", { operation: "forms.switchForm" });
  switching.add(form);
  try {
    const before = switchSnapshot(form, id);
    if (before.currentId === id) return { status: "alreadyCurrent", formId: id };
    if (isDirty(form)) {
      if (options.dirtyPolicy === "reject") throw new VbdError("DIRTY_FORM", { operation: "forms.switchForm" });
      await save(form);
      if (formOf(input) !== form) {
        throw new VbdError("RESOURCE_NOT_FOUND", { operation: "forms.switchForm" });
      }
      const after = switchSnapshot(form, id);
      if (after.data !== before.data || after.entity !== before.entity || after.ui !== before.ui ||
          after.selector !== before.selector || after.items !== before.items ||
          after.current !== before.current || after.currentId !== before.currentId ||
          after.target !== before.target || after.methods.some((method, index) => method !== before.methods[index]) ||
          after.record !== before.record || after.table !== before.table) {
        throw new VbdError("RESOURCE_CONFLICT", { operation: "forms.switchForm" });
      }
    }
    // No implicit discard: navigate's native dirty prompt is not a dirty-policy implementation.
    if (isDirty(form)) throw new VbdError("DIRTY_FORM", { operation: "forms.switchForm" });
    call(before.target, "navigate");
    return { status: "requested", formId: id };
  } finally { switching.delete(form); }
}
export function notificationId(id: string): string {
  return `vbd_toolkit_${parseInput(nameSchema, id, "forms.notification")}`;
}
function setNotification(input: unknown, id: string, message: string, level: "ERROR" | "WARNING" | "INFO") {
  parseInput(z.enum(["ERROR", "WARNING", "INFO"]), level, "forms.notification");
  const result = resultOf(z.boolean(), call(formOf(input).ui, "setFormNotification",
    parseInput(messageSchema, message, "forms.notification"), level, notificationId(id)));
  if (!result) throw new VbdError("SDK_OPERATION_FAILED", { operation: "forms.notification" });
  return { displayed: true };
}
function clearNotification(input: unknown, id: string) {
  const removed = resultOf(z.boolean(), call(formOf(input).ui, "clearFormNotification", notificationId(id)));
  return { removed };
}
export const Fields = Object.freeze({ get, set, clear, copy, setDefault, setRequired, setSubmitMode, fireOnChange, getLookup, setLookup });
export const Forms = Object.freeze({ save, refresh, isDirty, getType, setNotification, clearNotification, switchForm });
