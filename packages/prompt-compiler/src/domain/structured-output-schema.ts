import type { Identifier } from "@hexagen/shared";
import { z } from "zod";

/**
 * StructuredOutputSchema defines the expected structure and validation rules
 * for LLM responses. Uses Zod for schema definition and validation.
 */
export interface StructuredOutputSchema {
  id: Identifier;
  schema: z.ZodTypeAny;
  version: number;
  /**
   * Timestamp when this schema was last updated
   */
  updatedAt: string;
}

/**
 * Creates a new StructuredOutputSchema with a generated ID and current timestamp
 */
export function createStructuredOutputSchema(
  schema: z.ZodTypeAny,
  version: number = 1,
): StructuredOutputSchema {
  return {
    id: `structured-schema-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 9)}`,
    schema,
    version,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Updates an existing StructuredOutputSchema with new schema and increments version
 */
export function updateStructuredOutputSchema(
  schemaObj: StructuredOutputSchema,
  schema: z.ZodTypeAny,
): StructuredOutputSchema {
  return {
    ...schemaObj,
    schema,
    version: schemaObj.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Validates data against a StructuredOutputSchema
 * Returns a Result object indicating success or failure
 */
export function validateStructuredOutput<T>(
  schemaObj: StructuredOutputSchema,
  data: unknown,
): { success: true; value: T } | { success: false; error: z.ZodError } {
  const result = schemaObj.schema.safeParse(data);
  if (result.success) {
    return { success: true, value: result.data as T };
  }
  return { success: false, error: result.error };
}
