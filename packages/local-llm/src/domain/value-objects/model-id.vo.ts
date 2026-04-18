import { type Result, ok, err } from "@hexagen/shared";

/**
 * DomainModelId: Domain-level model identifier
 *
 * This value object represents models in domain language, independent of
 * any infrastructure implementation (e.g., WebLLM, cloud providers).
 *
 * Each variant below represents a unique model that the system can load.
 */

export enum DomainModelId {
  // Desktop High-End (4-5 star, 2.6+ GB VRAM)
  QWEN_CODER_3B = "qwen-coder-3b",
  LLAMA_3_2_3B = "llama-3.2-3b",
  PHI_3_5_MINI = "phi-3.5-mini",
  // Desktop Compact (3-4 star, 1.5-2.2 GB VRAM)
  GEMMA_2_2B = "gemma-2-2b",
  QWEN_CODER_1_5B = "qwen-coder-1.5b",
  // Ultra-Light (2-3 star, <1.5 GB VRAM)
  LLAMA_3_2_1B = "llama-3.2-1b",
  QWEN_CODER_0_5B = "qwen-coder-0.5b",
}

export const DEFAULT_MODEL_ID = DomainModelId.QWEN_CODER_3B;

/**
 * Legacy model IDs that were removed and their migration targets.
 * Enables backward compatibility for users with persisted model IDs.
 */
export const LEGACY_MODEL_MIGRATION: Record<string, DomainModelId> = {
  "qwen-2.5-3b": DomainModelId.QWEN_CODER_3B,
  "smollm2-1.7b": DomainModelId.QWEN_CODER_1_5B,
  "phi-3-mini": DomainModelId.PHI_3_5_MINI,
};

/**
 * Type guard to ensure a string is a valid DomainModelId
 */
export function isDomainModelId(value: unknown): value is DomainModelId {
  return Object.values(DomainModelId).includes(value as DomainModelId);
}

/**
 * Parse a string into DomainModelId with error handling
 */
export function parseDomainModelId(value: unknown): Result<DomainModelId> {
  if (isDomainModelId(value)) {
    return ok(value);
  }
  const displayValue =
    typeof value === "object" && value !== null
      ? JSON.stringify(value)
      : String(value);
  return err(new Error(`Invalid DomainModelId: ${displayValue}`));
}
