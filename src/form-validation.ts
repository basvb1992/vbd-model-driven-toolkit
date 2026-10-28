import { z } from "zod";
import { Context, formOf } from "./context.js";
import { Fields, Forms } from "./forms.js";
import { entityRefSchema } from "./entity-reference.js";
import { VbdError } from "./errors.js";
import { call, messageSchema, nameSchema, requireMethod, sdkObject } from "./sdk.js";
import { isRecord, logicalNameSchema, parseInput } from "./validation.js";
import { dateMilliseconds, Utils } from "./utils.js";

const base = z.object({ id: nameSchema, field: logicalNameSchema, message: messageSchema.optional() }).strict();
const scalar = z.union([
  z.string().max(1_048_576), z.number().finite(), z.boolean(), z.null(), entityRefSchema,
  z.custom<Date>(value => dateMilliseconds(value) !== undefined)
]);
const ruleSchema = z.discriminatedUnion("kind", [
  base.extend({ kind: z.literal("required") }),
  base.extend({
    kind: z.literal("range"), min: z.number().finite().optional(), max: z.number().finite().optional()
  }).refine(value => (value.min !== undefined || value.max !== undefined) &&
    (value.min === undefined || value.max === undefined || value.min <= value.max)),
  base.extend({
    kind: z.literal("length"), min: z.number().int().min(0).optional(), max: z.number().int().min(0).optional()
  }).refine(value => (value.min !== undefined || value.max !== undefined) &&
    (value.min === undefined || value.max === undefined || value.min <= value.max)),
  base.extend({ kind: z.literal("equals"), expected: z.union([scalar, z.array(scalar).max(1000)]) }),
  base.extend({ kind: z.literal("format"), format: z.enum(["email", "httpsUrl", "guid"]) })
]);
const rulesSchema = z.array(ruleSchema).max(200).refine(values => new Set(values.map(value => value.id)).size === values.length);
export type ValidationRule = z.input<typeof ruleSchema>;
export interface ValidationIssue { id: string; field: string; code: string; message: string }
export interface ValidationReport { valid: boolean; issues: ValidationIssue[] }
export function parseRules(input: readonly ValidationRule[] | string): z.output<typeof rulesSchema> {
  let value: unknown = input;
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).byteLength > 262144) {
      throw new VbdError("LIMIT_EXCEEDED", { operation: "validation.rules" });
    }
    try { value = JSON.parse(input); }
    catch (cause) { throw new VbdError("INVALID_ARGUMENT", { operation: "validation.rules", cause }); }
  }
  return parseInput(rulesSchema, value, "validation.rules");
}
function evaluate(input: readonly ValidationRule[] | string, values: Record<string, unknown>): ValidationReport {
  const rules = parseRules(input);
  if (!isRecord(values) || Object.prototype.toString.call(values) !== "[object Object]") {
    throw new VbdError("INVALID_ARGUMENT", { operation: "validation.evaluate" });
  }
  const issues: ValidationIssue[] = [];
  for (const rule of rules) {
    const value = Object.prototype.hasOwnProperty.call(values, rule.field) ? values[rule.field] : undefined;
    if (value !== undefined) parseInput(z.union([scalar, z.array(scalar).max(1000)]), value, "validation.value");
    const empty = value === null || value === undefined || (typeof value === "string" && value.trim() === "") ||
      (Array.isArray(value) && value.length === 0);
    let valid = true;
    if (rule.kind === "required") valid = !empty;
    else if (!empty) {
      switch (rule.kind) {
        case "range":
          valid = typeof value === "number" && Number.isFinite(value) &&
            (rule.min === undefined || value >= rule.min) && (rule.max === undefined || value <= rule.max);
          break;
        case "length":
          valid = (typeof value === "string" || Array.isArray(value)) &&
            (rule.min === undefined || value.length >= rule.min) && (rule.max === undefined || value.length <= rule.max);
          break;
        case "equals": valid = Utils.compareValues(value, rule.expected, "eq"); break;
        case "format":
          if (typeof value !== "string") { valid = false; break; }
          if (rule.format === "guid") valid = Utils.isGuid(value);
          else if (rule.format === "email") valid = value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
          else {
            try {
              const url = new URL(value);
              valid = value.trim() === value && url.protocol === "https:" && !url.username && !url.password;
            } catch { valid = false; }
          }
          break;
      }
    } else if (rule.kind === "equals") {
      valid = Utils.compareValues(value === undefined ? null : value, rule.expected, "eq");
    }
    if (!valid) issues.push({
      id: rule.id, field: rule.field, code: rule.kind,
      message: rule.message ?? `${rule.field} does not satisfy the ${rule.kind} rule.`
    });
  }
  return { valid: issues.length === 0, issues };
}
function validateFields(input: unknown, ruleInput: readonly ValidationRule[] | string, settings: {
  notificationId?: string;
} = {}): ValidationReport {
  const options = parseInput(z.object({ notificationId: nameSchema.default("validation") }).strict(),
    settings, "validation.validateFields");
  const rules = parseRules(ruleInput), form = formOf(input);
  const fields = [...new Set(rules.map(rule => rule.field))];
  if (fields.length > 100) throw new VbdError("LIMIT_EXCEEDED", { operation: "validation.validateFields" });
  const values = Object.fromEntries(fields.map(field => [field, Fields.get(form, field)]));
  const report = evaluate(rules, values);
  if (report.valid) Forms.clearNotification(form, options.notificationId);
  else {
    const first = report.issues[0];
    if (!first) throw new VbdError("DATA_RESPONSE_INVALID", { operation: "validation.validateFields" });
    const suffix = report.issues.length > 1 ? ` (+${report.issues.length - 1} more)` : "";
    Forms.setNotification(form, options.notificationId, `${first.message.slice(0, 8192 - suffix.length)}${suffix}`, "ERROR");
  }
  return report;
}
function validateBeforeSave(executionContext: unknown, rules: readonly ValidationRule[] | string, settings: {
  notificationId?: string;
} = {}): ValidationReport & { prevented: boolean } {
  const context = Context.fromFormEvent(executionContext), args = sdkObject(context.eventArgs);
  requireMethod(args, "preventDefault");
  try {
    const report = validateFields(context, rules, settings);
    if (!report.valid) call(args, "preventDefault");
    return { ...report, prevented: !report.valid };
  } catch (error) {
    call(args, "preventDefault");
    throw error;
  }
}
export const Validation = Object.freeze({ evaluate, validateFields, validateBeforeSave });
