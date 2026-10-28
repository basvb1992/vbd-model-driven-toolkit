import { z } from "zod";
import { VbdError } from "./errors.js";
import { entityReference, entityRefSchema } from "./entity-reference.js";
import type { EntityRef } from "./entity-reference.js";
import { guidSchema, parseInput, parseInvariantNumber } from "./validation.js";

export function dateMilliseconds(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  try {
    const time: unknown = Reflect.apply(Date.prototype.getTime, value, []);
    return typeof time === "number" && Number.isFinite(time) ? time : undefined;
  } catch {
    return undefined;
  }
}

function normalizeGuid(value: unknown): string {
  return parseInput(guidSchema, value, "utils.normalizeGuid");
}
function isGuid(value: unknown): boolean {
  return guidSchema.safeParse(value).success;
}
function toEntityRef(entityType: string, id: string, name?: string): EntityRef {
  return entityReference({ entityType, id, ...(name === undefined ? {} : { name }) });
}
export function assertXmlCharacters(value: string): void {
  for (const character of value) {
    const point = character.codePointAt(0);
    if (point === undefined || !(
      point === 9 || point === 10 || point === 13 || (point >= 32 && point <= 0xd7ff) ||
      (point >= 0xe000 && point <= 0xfffd) || (point >= 0x10000 && point <= 0x10ffff)
    )) throw new VbdError("INVALID_ARGUMENT", { operation: "utils.escapeXml" });
  }
}
function escapeXml(value: string): string {
  parseInput(z.string().max(1_048_576), value, "utils.escapeXml");
  assertXmlCharacters(value);
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&apos;";
    }
  });
}
function escapeODataLiteral(value: unknown, type: "string" | "number" | "boolean" | "guid" | "date"): string {
  parseInput(z.enum(["string", "number", "boolean", "guid", "date"]), type, "utils.escapeODataLiteral");
  if (value === null) { return "null"; }
  switch (type) {
    case "string": {
      const text = parseInput(z.string().max(1_048_576), value, "utils.escapeODataLiteral");
      if (/[\ud800-\udfff]/u.test(text)) throw new VbdError("INVALID_ARGUMENT", { operation: "utils.escapeODataLiteral" });
      return `'${text.replace(/'/g, "''")}'`;
    }
    case "number": return String(parseInvariantNumber(value));
    case "boolean": return String(parseInput(z.boolean(), value, "utils.escapeODataLiteral"));
    case "guid": return normalizeGuid(value);
    case "date": {
      const time = dateMilliseconds(value);
      if (time === undefined) { throw new VbdError("INVALID_ARGUMENT", { operation: "utils.escapeODataLiteral" }); }
      return new Date(time).toISOString();
    }
  }
}

function comparableKey(value: unknown): string {
  if (value === null) { return "null"; }
  if (typeof value === "string" && value.length <= 1_048_576) { return `s:${value}`; }
  if (typeof value === "boolean") { return `b:${value}`; }
  if (typeof value === "number" && Number.isFinite(value)) { return `n:${value}`; }
  const date = dateMilliseconds(value);
  if (date !== undefined) { return `d:${date}`; }
  const ref = entityRefSchema.safeParse(value);
  if (ref.success) { return `r:${ref.data.entityType}:${ref.data.id}`; }
  throw new VbdError("INVALID_ARGUMENT", { operation: "utils.compareValues" });
}
function arrayKeys(value: unknown[]): string[] {
  if (value.length > 1000) { throw new VbdError("LIMIT_EXCEEDED", { operation: "utils.compareValues" }); }
  return value.map(comparableKey);
}
function compareValues(
  left: unknown, right: unknown,
  operator: "eq" | "ne" | "gt" | "ge" | "lt" | "le" | "contains" | "in"
): boolean {
  parseInput(z.enum(["eq", "ne", "gt", "ge", "lt", "le", "contains", "in"]), operator, "utils.compareValues");
  if (operator === "contains" || operator === "in") {
    const container = operator === "contains" ? left : right;
    const item = operator === "contains" ? right : left;
    if (typeof container === "string" && typeof item === "string") {
      return container.includes(item);
    }
    if (Array.isArray(container)) { return arrayKeys(container).includes(comparableKey(item)); }
    throw new VbdError("INVALID_ARGUMENT", { operation: "utils.compareValues" });
  }
  if (operator === "eq" || operator === "ne") {
    const first = Array.isArray(left) ? arrayKeys(left).sort() : comparableKey(left);
    const second = Array.isArray(right) ? arrayKeys(right).sort() : comparableKey(right);
    const same = JSON.stringify(first) === JSON.stringify(second);
    return operator === "eq" ? same : !same;
  }
  if (left === null || right === null) { return false; }
  let order: number;
  if (typeof left === "number" && Number.isFinite(left) && typeof right === "number" && Number.isFinite(right)) {
    order = left < right ? -1 : left > right ? 1 : 0;
  } else if (typeof left === "string" && typeof right === "string") {
    order = left < right ? -1 : left > right ? 1 : 0;
  } else {
    const first = dateMilliseconds(left), second = dateMilliseconds(right);
    if (first === undefined || second === undefined) {
      throw new VbdError("INVALID_ARGUMENT", { operation: "utils.compareValues" });
    }
    order = first < second ? -1 : first > second ? 1 : 0;
  }
  return operator === "gt" ? order > 0 : operator === "ge" ? order >= 0
    : operator === "lt" ? order < 0 : order <= 0;
}
export const Utils = Object.freeze({
  normalizeGuid, isGuid, toEntityRef, escapeODataLiteral, escapeXml,
  parseNumber: parseInvariantNumber, compareValues
});
