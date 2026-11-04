import { I18n } from "./i18n.js";
import type { DateFormatOptions, NumberFormatOptions } from "./i18n.js";
import { dateFormatter, numberFormatter } from "./i18n-format.js";
import { integer, invalid, keysOnly, limit, locale, oneOf, record, text } from "./i18n-core.js";
import { entityReference } from "./entity-reference.js";
import type { EntityRef } from "./entity-reference.js";

export type DisplayValue =
  | { readonly kind: "text"; readonly value: string | null }
  | { readonly kind: "boolean"; readonly value: boolean | null; readonly labels: { readonly true: string; readonly false: string } }
  | { readonly kind: "number"; readonly value: number | null; readonly format: NumberFormatOptions }
  | { readonly kind: "date"; readonly value: string | Date | null; readonly format: DateFormatOptions }
  | { readonly kind: "reference"; readonly value: EntityRef | null; readonly label: { readonly reference: EntityRef; readonly text: string } }
  | { readonly kind: "choice"; readonly value: number | null; readonly labels: readonly { readonly value: number; readonly label: string }[] };
export interface ValueFormatOptions {
  readonly locale: string;
  readonly nulls: { readonly policy: "error" } | { readonly policy: "label"; readonly label: string };
}

function reference(input: unknown): EntityRef {
  const operation = "utils.formatValue", ref = record(input, operation);
  keysOnly(ref, ["entityType", "id", "name"], operation);
  if (Object.hasOwn(ref, "name")) text(ref.name, operation);
  return entityReference(ref);
}

/** Display-only dispatcher. Numeric/date formatting uses the I18n contracts. */
export function formatValue(input: DisplayValue, settings: ValueFormatOptions): string {
  const operation = "utils.formatValue", options = record(settings, operation);
  keysOnly(options, ["locale", "nulls"], operation);
  const tag = locale(options.locale, operation), nulls = record(options.nulls, operation);
  const nullPolicy = oneOf(nulls.policy, ["error", "label"], operation);
  keysOnly(nulls, ["policy", ...(nullPolicy === "label" ? ["label"] : [])], operation);
  const nullLabel = nullPolicy === "label" ? text(nulls.label, operation) : undefined;
  const value = record(input, operation);
  const kind = oneOf(value.kind, ["text", "boolean", "number", "date", "reference", "choice"], operation);
  keysOnly(value, ["kind", "value", ...(["boolean", "choice"].includes(kind) ? ["labels"] :
    kind === "reference" ? ["label"] : ["number", "date"].includes(kind) ? ["format"] : [])], operation);
  if (!Object.hasOwn(value, "value")) return invalid(operation);
  // Validate supplied formatting/label configuration even for null values.
  let render: () => string;
  switch (kind) {
    case "text":
      render = () => text(value.value, operation);
      break;
    case "boolean": {
      const labels = record(value.labels, operation);
      keysOnly(labels, ["true", "false"], operation);
      const yes = text(labels.true, operation), no = text(labels.false, operation);
      render = () => {
        if (typeof value.value !== "boolean") return invalid(operation);
        return value.value ? yes : no;
      };
      break;
    }
    case "number": {
      const format = value.format as NumberFormatOptions;
      numberFormatter(tag, format);
      render = () => I18n.formatNumber(value.value as number, tag, format);
      break;
    }
    case "date": {
      const format = value.format as DateFormatOptions;
      dateFormatter(tag, format);
      render = () => I18n.formatDate(value.value as string | Date, tag, format);
      break;
    }
    case "reference": {
      const label = record(value.label, operation);
      keysOnly(label, ["reference", "text"], operation);
      const labelled = reference(label.reference), display = text(label.text, operation);
      render = () => {
        const actual = reference(value.value);
        if (actual.entityType !== labelled.entityType || actual.id !== labelled.id) return invalid(operation);
        return display;
      };
      break;
    }
    case "choice": {
      if (!Array.isArray(value.labels)) return invalid(operation);
      const entries = value.labels;
      if (entries.length > 256) return limit(operation);
      if (Reflect.ownKeys(entries).length !== entries.length + 1) return invalid(operation);
      const labels = new Map<number, string>();
      for (let index = 0; index < entries.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(entries, String(index));
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return invalid(operation);
        const entry = record(descriptor.value, operation);
        keysOnly(entry, ["value", "label"], operation);
        const key = integer(entry.value, -2147483648, 2147483647, operation);
        if (labels.has(key)) return invalid(operation);
        labels.set(key, text(entry.label, operation));
      }
      render = () => {
        const key = integer(value.value, -2147483648, 2147483647, operation);
        const display = labels.get(key);
        if (display === undefined) return invalid(operation);
        return display;
      };
      break;
    }
  }
  if (value.value !== null) return render();
  if (nullLabel === undefined) return invalid(operation);
  return nullLabel;
}
