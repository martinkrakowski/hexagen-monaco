/**
 * IntentLineage - MVK v1
 *
 * This file is part of the batched emission of MVK v1 TypeScript scaffold.
 * See mvk-compilation-pass: cp-2026-04-20-01
 */

/**
 * IntentLineage - Tracks the causal chain of intents that led to a DomainCommand
 * Used for version validation, conflict detection, and audit trails
 */
export interface IntentLineage {
  /** Unique identifier for this intent sequence */
  intentId: string; // Format: intentId_vN where N is version number

  /** Parent intent in causal chain (null for root intents) */
  parentIntentId?: string;

  /** Timestamp of intent creation */
  timestamp: number; // Unix milliseconds

  /** Origin of intent */
  origin:
    | { type: "user"; actorId: string } // Direct user action
    | { type: "system"; trigger: string } // System-generated
    | { type: "llm"; modelId: string; promptHash: string }; // LLM-generated

  /** Version contract this intent targets */
  targetContract: {
    mvkVersion: string;
    rrpVersion: string;
    remVersion: string;
  };

  /** Validation status */
  validation: {
    valid: boolean;
    reason?: string; // Human-readable explanation if invalid
  };
}

// Runtime functions moved to @hexagen/runtime
// Use generateIntentId() and isIntentLineage() from @hexagen/runtime instead
