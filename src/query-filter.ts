import { z } from "zod";
import { Utils } from "./utils.js";
import { logicalNameSchema, parseInput } from "./validation.js";
import { fail, odataReadPropertySchema, ownKeys, plain, safeKey } from "./data-core.js";

export type ScalarType = "string" | "number" | "boolean" | "guid" | "date";
export type FilterOperator = "eq" | "ne" | "gt" | "ge" | "lt" | "le" | "contains" | "in";
export type FilterNode =
  | { kind: "and" | "or"; conditions: readonly FilterNode[] }
  | { kind: "not"; condition: FilterNode }
  | { kind: "condition"; column: string; operator: FilterOperator; value: unknown };
export interface FilterPolicy {
  columns: Record<string, ScalarType>;
  operators: readonly FilterOperator[];
  format: "odata" | "fetchxml";
}

/** No raw structural fragments. Maximum depth 8, 100 total nodes and 100 in-list values. */
export function buildFilter(input: FilterNode, settings: FilterPolicy): string {
  const policy = parseInput(z.object({
    columns: z.record(z.string(), z.enum(["string", "number", "boolean", "guid", "date"]))
      .refine((value) => Object.keys(value).length > 0 && Object.keys(value).length <= 100 &&
        Object.keys(value).every(safeKey)),
    operators: z.array(z.enum(["eq", "ne", "gt", "ge", "lt", "le", "contains", "in"])).min(1).max(8),
    format: z.enum(["odata", "fetchxml"])
  }).strict(), settings, "query.filter");
  const propertySchema = policy.format === "odata" ? odataReadPropertySchema : logicalNameSchema;
  for (const column of Object.keys(policy.columns)) {
    parseInput(propertySchema, column, "query.filter");
  }
  let count = 0;
  const seen = new Set<object>();
  const xml = policy.format === "fetchxml";
  const visit = (node: unknown, depth: number): string => {
    if (depth > 8 || ++count > 100) { return fail("LIMIT_EXCEEDED"); }
    if (!plain(node) || seen.has(node)) { return fail(); }
    seen.add(node);
    let result: string;
    if (node.kind === "and" || node.kind === "or") {
      ownKeys(node, ["kind", "conditions"]);
      if (!Array.isArray(node.conditions) || node.conditions.length < 1 || node.conditions.length > 100) {
        return fail();
      }
      const parts = node.conditions.map((child) => visit(child, depth + 1));
      result = xml ? `<filter type="${node.kind}">${parts.join("")}</filter>`
        : `(${parts.join(` ${node.kind} `)})`;
    } else if (node.kind === "not") {
      ownKeys(node, ["kind", "condition"]);
      if (xml) { return fail(); } // FetchXML has no general NOT filter.
      result = `not (${visit(node.condition, depth + 1)})`;
    } else if (node.kind === "condition") {
      ownKeys(node, ["kind", "column", "operator", "value"]);
      const column = parseInput(propertySchema, node.column, "query.filter");
      if (!Object.hasOwn(policy.columns, column)) { return fail(); }
      const type = policy.columns[column];
      const operator = parseInput(z.enum(["eq", "ne", "gt", "ge", "lt", "le", "contains", "in"]),
        node.operator, "query.filter");
      if (!type || !policy.operators.includes(operator)) { return fail(); }
      const scalar = (value: unknown): string => {
        if (type === "number" && typeof value !== "number") { return fail(); }
        const literal = Utils.escapeODataLiteral(value, type);
        if (!xml) { return literal; }
        const text = value === null ? "" : type === "string" ? String(value)
          : type === "boolean" ? (value ? "1" : "0") : literal;
        return Utils.escapeXml(text);
      };
      if (operator === "in") {
        if (!Array.isArray(node.value) || node.value.length < 1 || node.value.length > 100 ||
            node.value.includes(null)) { return fail(); }
        const values = node.value.map(scalar);
        result = xml ? `<condition attribute="${column}" operator="in">${values.map(
          (value) => `<value>${value}</value>`).join("")}</condition>`
          : `(${values.map((value) => `${column} eq ${value}`).join(" or ")})`;
      } else if (node.value === null) {
        if (operator !== "eq" && operator !== "ne") { return fail(); }
        result = xml ? `<condition attribute="${column}" operator="${operator === "eq" ? "null" : "not-null"}"/>`
          : `${column} ${operator} null`;
      } else if (operator === "contains") {
        if (type !== "string" || xml) { return fail(); } // Avoid accidental FetchXML LIKE wildcards.
        result = `contains(${column},${scalar(node.value)})`;
      } else {
        result = xml ? `<condition attribute="${column}" operator="${operator}" value="${scalar(node.value)}"/>`
          : `${column} ${operator} ${scalar(node.value)}`;
      }
    } else { return fail(); }
    seen.delete(node);
    return result;
  };
  const result = visit(input, 0);
  if (new TextEncoder().encode(result).byteLength > 65_536) { return fail("LIMIT_EXCEEDED"); }
  return xml ? `<filter type="and">${result}</filter>` : result;
}
