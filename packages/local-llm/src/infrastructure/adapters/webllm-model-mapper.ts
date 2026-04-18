/**
 * WebLLM Model Mapper
 *
 * Translates between domain model IDs (DomainModelId) and WebLLM/MLC engine IDs.
 *
 * This adapter ensures that:
 * 1. Domain logic remains independent of infrastructure implementation details
 * 2. All model ID translation happens in one place (testable, easy to extend)
 * 3. Worker protocol receives the correct MLC engine IDs
 */

import { DomainModelId } from "../../domain/value-objects/model-id.vo.js";

/**
 * Mapping from domain model IDs to WebLLM/MLC engine IDs
 *
 * The MLC IDs must match exactly what @mlc-ai/web-llm expects.
 * See: https://github.com/mlc-ai/web-llm
 */
const DOMAIN_TO_MLC_ID_MAP: Record<DomainModelId, string> = {
  [DomainModelId.QWEN_2_5_3B]: "Qwen2.5-3B-Instruct-q4f16_1-MLC",
  [DomainModelId.SMOLLM2_1_7B]: "SmolLM2-1.7B-Instruct-q4f32_1-MLC",
  [DomainModelId.PHI3_MINI]: "Phi-3-mini-4k-instruct-q4f16_1-MLC",
};

const MLC_ID_TO_DOMAIN_MAP: Record<string, DomainModelId> = Object.entries(
  DOMAIN_TO_MLC_ID_MAP,
).reduce(
  (acc, [domainId, mlcId]) => {
    acc[mlcId] = domainId as DomainModelId;
    return acc;
  },
  {} as Record<string, DomainModelId>,
);

/**
 * Convert domain model ID to WebLLM/MLC engine ID
 */
export function domainIdToMlcId(domainId: DomainModelId): string {
  return DOMAIN_TO_MLC_ID_MAP[domainId];
}

/**
 * Convert WebLLM/MLC engine ID to domain model ID
 * Returns undefined if the MLC ID is not recognized
 */
export function mlcIdToDomainId(mlcId: string): DomainModelId | undefined {
  return MLC_ID_TO_DOMAIN_MAP[mlcId];
}

/**
 * Get all supported MLC engine IDs
 */
export function getAllMlcIds(): string[] {
  return Object.values(DOMAIN_TO_MLC_ID_MAP);
}
