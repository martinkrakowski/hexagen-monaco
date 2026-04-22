import type { Identifier } from "@hexagen/shared";
import type { DomainModelId } from "./model-id.vo.js";

/**
 * SchemaValidationResult value object — represents the result of validating
 * an LLM response against a structured output schema.
 * Used to enforce ACL: schema validation must occur at the response boundary.
 */
export type SchemaValidationResult<T> =
  | { success: true; value: T; schemaId: Identifier; modelId: DomainModelId }
  | {
      success: false;
      error: unknown;
      schemaId: Identifier;
      modelId: DomainModelId;
      rawResponse: string;
    };

/**
 * Creates a successful SchemaValidationResult
 */
export function createSuccessSchemaValidationResult<T>(
  value: T,
  schemaId: Identifier,
  modelId: DomainModelId,
): SchemaValidationResult<T> {
  return {
    success: true,
    value,
    schemaId,
    modelId,
  };
}

/**
 * Creates a failed SchemaValidationResult
 */
export function createFailureSchemaValidationResult(
  error: unknown,
  schemaId: Identifier,
  modelId: DomainModelId,
  rawResponse: string,
): SchemaValidationResult<never> {
  return {
    success: false,
    error,
    schemaId,
    modelId,
    rawResponse,
  };
}
