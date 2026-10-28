import { z } from "zod";
import { guidSchema, logicalNameSchema, parseInput } from "./validation.js";

export const entityRefSchema = z.object({
  entityType: logicalNameSchema.transform((value) => value.toLowerCase()),
  id: guidSchema,
  name: z.string().max(8192).optional()
}).strict();
export type EntityRef = z.output<typeof entityRefSchema>;

export function entityReference(input: unknown): EntityRef {
  return parseInput(entityRefSchema, input, "entity.reference");
}
