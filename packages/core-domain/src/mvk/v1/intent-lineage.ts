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

/**
 * Generates a new intent ID based on the parent intent (if any) and version
 * @param parentId - Optional parent intent ID
 * @param version - Current version number
 * @returns New intent ID in format: intentId_vN
 */
export function generateIntentId(parentId: string | undefined, version: number): string {
  const baseId = parentId || "intentId";
  return `${baseId}_v${version}`;
}

/**
 * Type guard for IntentLineage
 * @param value - Value to check
 * @returns true if value is a valid IntentLineage
 */
export function isIntentLineage(value: unknown): value is IntentLineage {
  if (typeof value !== "object" || value === null) return false;
  
  const lineage = value as IntentLineage;
  return (
    typeof lineage.intentId === "string" &&
    (lineage.parentIntentId === undefined || typeof lineage.parentIntentId === "string") &&
    typeof lineage.timestamp === "number" &&
    typeof lineage.origin === "object" && lineage.origin !== null &&
    "type" in lineage.origin &&
    (lineage.origin.type === "user" || lineage.origin.type === "system" || lineage.origin.type === "llm") &&
    typeof lineage.targetContract === "object" && lineage.targetContract !== null &&
    typeof lineage.targetContract.mvkVersion === "string" &&
    typeof lineage.targetContract.rrpVersion === "string" &&
    typeof lineage.targetContract.remVersion === "string" &&
    typeof lineage.validation === "object" && lineage.validation !== null &&
    typeof lineage.validation.valid === "boolean" &&
    (lineage.validation.reason === undefined || typeof lineage.validation.reason === "string")
  );
}