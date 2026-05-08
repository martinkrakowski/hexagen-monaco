import type { DomainModelId } from "@hexagen/local-llm/shared";

export interface ModelVerificationResult {
  isValid: boolean;
  reason?: string;
  isTimeout?: boolean;
}

export function isModelRecentlyVerified(
  verifiedAt: number | null,
  maxAgeHours: number = 24,
): boolean {
  if (verifiedAt === null) return false;
  const nowMs = Date.now();
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  return nowMs - verifiedAt < maxAgeMs;
}

export function createSmokeTestPredicate(
  _modelId: DomainModelId,
  verifiedAt: number | null,
) {
  return (): ModelVerificationResult => {
    if (isModelRecentlyVerified(verifiedAt)) {
      return { isValid: true };
    }
    return { isValid: false, reason: "Model not recently verified" };
  };
}

export function formatVerificationFailure(error: unknown): {
  message: string;
  isTimeout: boolean;
} {
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  const isTimeout = errorMessage.includes("timed out");
  return {
    message: isTimeout
      ? "The model failed to respond in time. It may be corrupted or too slow for this device."
      : "The model cache appears to be corrupted. You can repair the download.",
    isTimeout,
  };
}

export function createVerificationResult(
  isValid: boolean,
  isTimeout: boolean = false,
  reason?: string,
): ModelVerificationResult {
  return { isValid, isTimeout, reason };
}
