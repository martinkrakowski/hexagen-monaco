/**
 * DomainModelId: Domain-level model identifier
 *
 * This value object represents models in domain language, independent of
 * any infrastructure implementation (e.g., WebLLM, cloud providers).
 *
 * Each variant below represents a unique model that the system can load.
 * The infrastructure adapter (webllm.adapter.ts) maps DomainModelId to
 * infrastructure-specific identifiers (e.g., MLC engine IDs).
 */

export enum DomainModelId {
  QWEN_2_5_3B = "qwen-2.5-3b",
  SMOLLM2_1_7B = "smollm2-1.7b",
  PHI3_MINI = "phi-3-mini",
}

export const DEFAULT_MODEL_ID = DomainModelId.QWEN_2_5_3B;

/**
 * Type guard to ensure a string is a valid DomainModelId
 */
export function isDomainModelId(value: unknown): value is DomainModelId {
  return Object.values(DomainModelId).includes(value as DomainModelId);
}

/**
 * Parse a string into DomainModelId with error handling
 */
export function parseDomainModelId(
  value: unknown,
): { success: true; value: DomainModelId } | { success: false; error: Error } {
  if (isDomainModelId(value)) {
    return { success: true, value };
  }
  return {
    success: false,
    error: new Error(`Invalid DomainModelId: ${value}`),
  };
}
