import type { Identifier } from "@hexagen/shared";
import type { StructuredOutputSchema } from "../../../domain/index.js";

/**
 * Request to generate a Zod schema for structured output validation
 */
export interface GenerateZodSchemaRequest {
  /** Name for the schema */
  name: string;
  /** Description of what the schema should validate */
  description: string;
  /** Example data that should conform to the schema */
  exampleData: unknown;
  /** Optional template overrides */
  templateOverrides?: Record<string, string>;
}

/**
 * Port for generating Zod schemas that define expected LLM response structure
 */
export interface GenerateZodSchemaPort {
  /**
   * Generate a Zod schema from requirements
   * @param request Contains schema requirements and example data
   * @returns Promise resolving to the generated structured output schema
   */
  generate(request: GenerateZodSchemaRequest): Promise<StructuredOutputSchema>;
}

/**
 * Type guard for GenerateZodSchemaPort
 */
export function isGenerateZodSchemaPort(
  port: unknown,
): port is GenerateZodSchemaPort {
  if (port === null || typeof port !== "object") return false;
  const p = port as Record<string, unknown>;
  return typeof p.generate === "function";
}
