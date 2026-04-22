/**
 * Runtime intent ID generator and type guard
 * Moved from MVK layer to maintain IR-clean boundary
 */

import { IntentLineage } from "@hexagen/core-domain";

/**
 * Generates a new intent ID based on the parent intent (if any) and version
 * @param parentId - Optional parent intent ID
 * @param version - Current version number
 * @returns New intent ID in format: intentId_vN
 */
export function generateIntentId(
  parentId: string | undefined,
  version: number,
): string {
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
    (lineage.parentIntentId === undefined ||
      typeof lineage.parentIntentId === "string") &&
    typeof lineage.timestamp === "number" &&
    typeof lineage.origin === "object" &&
    lineage.origin !== null &&
    "type" in lineage.origin &&
    (lineage.origin.type === "user" ||
      lineage.origin.type === "system" ||
      lineage.origin.type === "llm") &&
    typeof lineage.targetContract === "object" &&
    lineage.targetContract !== null &&
    typeof lineage.targetContract.mvkVersion === "string" &&
    typeof lineage.targetContract.rrpVersion === "string" &&
    typeof lineage.targetContract.remVersion === "string" &&
    typeof lineage.validation === "object" &&
    lineage.validation !== null &&
    typeof lineage.validation.valid === "boolean" &&
    (lineage.validation.reason === undefined ||
      typeof lineage.validation.reason === "string")
  );
}
