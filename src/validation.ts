import { z } from "zod";
import { VbdError } from "./errors.js";

export const identifierSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9._-]{0,127}$/);
export const logicalNameSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,127}$/);
export const guidSchema = z.string()
  .regex(/^(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|\{[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\})$/i)
  .transform((value) => value.replace(/[{}]/g, "").toLowerCase());

export function parseInput<S extends z.ZodType>(schema: S, input: unknown, operation: string): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new VbdError("INVALID_ARGUMENT", { operation });
  }
  return parsed.data;
}

export function environmentRoot(input: unknown): URL {
  if (typeof input !== "string" || input.length > 4096 || input.trim() !== input || input.includes("\\")) {
    throw new VbdError("INVALID_URL", { operation: "url.validate" });
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch (cause) {
    throw new VbdError("INVALID_URL", { operation: "url.validate", cause });
  }
  if (url.protocol !== "https:" || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new VbdError("INVALID_URL", { operation: "url.validate" });
  }
  return url;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseInvariantNumber(
  input: unknown,
  settings: { min?: number | undefined; max?: number | undefined } = {}
): number {
  const options = parseInput(z.object({
    min: z.number().finite().optional(), max: z.number().finite().optional()
  }).strict(), settings, "utils.parseNumber");
  if (options.min !== undefined && options.max !== undefined && options.min > options.max) {
    throw new VbdError("INVALID_ARGUMENT", { operation: "utils.parseNumber" });
  }
  const text = typeof input === "string" ? input.trim() : undefined;
  const value = typeof input === "number" ? input : text !== undefined ? Number(text) : Number.NaN;
  if (!Number.isFinite(value) ||
      (text !== undefined && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) ||
      (options.min !== undefined && value < options.min) ||
      (options.max !== undefined && value > options.max)) {
    throw new VbdError("INVALID_ARGUMENT", { operation: "utils.parseNumber" });
  }
  return value;
}
