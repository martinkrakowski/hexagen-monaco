import type { Result } from "@hexagen/shared";
import { ok } from "@hexagen/shared";
import type {
  PreFlightValidationResult,
  PreFlightValidatorOptions,
  PreFlightValidatorPort,
} from "../ports/pre-flight-validator.port.js";
import type {
  ConnectionHealthState,
  LocalModelState,
} from "../../domain/index.js";

/**
 * Discriminated union describing the outcome of pre-flight validation.
 *
 * - PROCEED_TANDEM: Both engines available; run the full pipeline.
 * - BYPASS_LOCAL:   Local engine unavailable or insufficient; cloud-only path.
 * - BYPASS_CLOUD:   Cloud engine unavailable; local-only path.
 * - TERMINAL_FAILURE: Both engines unavailable; cannot proceed.
 */
export type PreFlightOutcome =
  | "PROCEED_TANDEM"
  | "BYPASS_LOCAL"
  | "BYPASS_CLOUD"
  | "TERMINAL_FAILURE";

/**
 * Simple word-count × 1.3 token estimate.
 * Consistent with the Stage 2 payload constructor (no external tokenizer).
 */
function estimateTokens(text: string): number {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(wordCount * 1.3);
}

/**
 * PreFlightValidatorUseCase
 *
 * Validates whether the tandem pipeline can proceed given the current state
 * of the local model and cloud provider.
 *
 * NOTE: `isStreamingRef` lifecycle is owned by TandemOrchestratorUseCase (3D).
 * This validator is synchronous and does NOT touch `isStreamingRef`.
 * The orchestrator sets `isStreamingRef.current = true` before calling validate
 * and releases it in its `finally` block across ALL exit paths.
 */
export class PreFlightValidatorUseCase implements PreFlightValidatorPort {
  /**
   * Validates pre-flight conditions and returns a discriminated outcome.
   *
   * Decision order:
   * 1. Both engines down → TERMINAL_FAILURE
   * 2. Local not ACTIVE → BYPASS_LOCAL (reason: 'none')
   * 3. Cloud UNAVAILABLE or UNVALIDATED → BYPASS_CLOUD
   * 4. Memory below threshold → BYPASS_LOCAL (reason: 'memory_insufficient')
   * 5. Prompt exceeds 80% of cloud context limit → BYPASS_LOCAL (reason: 'context_overflow')
   * 6. Otherwise → PROCEED_TANDEM
   */
  validate(
    localModelState: LocalModelState,
    cloudHealthState: ConnectionHealthState,
    options: PreFlightValidatorOptions,
  ): Result<PreFlightValidationResult, Error> {
    const cloudAvailable =
      cloudHealthState === "VALID" || cloudHealthState === "DEGRADED";

    // Rule 1: Both engines down → TERMINAL_FAILURE
    if (localModelState !== "ACTIVE" && !cloudAvailable) {
      return ok({
        success: false,
        bypassLocal: false,
        error: "Both engines unavailable",
      }) as Result<PreFlightValidationResult, Error>;
    }

    // Rule 2: Local not ACTIVE → BYPASS_LOCAL (cloud-only path)
    if (localModelState !== "ACTIVE") {
      return ok({
        success: true,
        bypassLocal: true,
        bypassReason: "none" as const,
      }) as Result<PreFlightValidationResult, Error>;
    }

    // Rule 3: Cloud UNAVAILABLE or UNVALIDATED → BYPASS_CLOUD
    if (
      cloudHealthState === "UNAVAILABLE" ||
      cloudHealthState === "UNVALIDATED"
    ) {
      return ok({
        success: true,
        bypassLocal: false,
      }) as Result<PreFlightValidationResult, Error>;
    }

    // Rule 4: Memory check
    if (
      options.deviceMemoryGb !== undefined &&
      options.memoryThresholdGb !== undefined &&
      options.deviceMemoryGb < options.memoryThresholdGb
    ) {
      return ok({
        success: true,
        bypassLocal: true,
        bypassReason: "memory_insufficient" as const,
      }) as Result<PreFlightValidationResult, Error>;
    }

    // Rule 5: Context overflow check (word count × 1.3 token estimate)
    if (options.cloudContextLimit !== undefined) {
      const estimatedTokens = estimateTokens(options.prompt);
      if (estimatedTokens > options.cloudContextLimit * 0.8) {
        return ok({
          success: true,
          bypassLocal: true,
          bypassReason: "context_overflow" as const,
        }) as Result<PreFlightValidationResult, Error>;
      }
    }

    // Rule 6: All healthy → PROCEED_TANDEM
    return ok({
      success: true,
      bypassLocal: false,
    }) as Result<PreFlightValidationResult, Error>;
  }

  /**
   * Maps a PreFlightValidationResult to a PreFlightOutcome discriminant.
   * Convenience helper used by the orchestrator.
   */
  static toOutcome(result: PreFlightValidationResult): PreFlightOutcome {
    if (!result.success) {
      return "TERMINAL_FAILURE";
    }
    if (result.bypassLocal) {
      return "BYPASS_LOCAL";
    }
    return "PROCEED_TANDEM";
  }
}
