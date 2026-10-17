/**
 * Pure budget rule for Jev decision calls (lane J1a). No npm imports.
 *
 * Invariant 6 (bounded spend): two caps; a call over either is not made.
 */

export interface BudgetCheckInput {
  /** Decision calls already made in this generation. */
  callsThisGeneration: number;
  /** `JEV_MAX_CALLS_PER_GENERATION` (default 20 upstream). */
  maxCalls: number;
  /** Sum of `decision_calls.cost_micro_usd` since midnight UTC (invariant 5). */
  spentTodayMicroUsd: number;
  /** In-process reservation for calls already dispatched but not settled. */
  reservedMicroUsd: number;
  /** `JEV_DAILY_COST_CEILING_USD` expressed in micro-USD (default 0.50). */
  ceilingMicroUsd: number;
  /** This call's maximum possible cost in micro-USD. */
  callMaxMicroUsd: number;
}

export type BudgetCheckResult =
  | { allowed: true }
  | { allowed: false; reason: "budget" };

/**
 * Allow a call only when the per-generation call cap and the daily cost
 * ceiling (including the in-process reservation and this call's maximum) both
 * still have room. A refused check means "no advice" (invariant 4).
 */
export function checkBudget(input: BudgetCheckInput): BudgetCheckResult {
  if (input.callsThisGeneration + 1 > input.maxCalls) {
    return { allowed: false, reason: "budget" };
  }
  const projected = input.spentTodayMicroUsd + input.reservedMicroUsd + input.callMaxMicroUsd;
  if (projected > input.ceilingMicroUsd) {
    return { allowed: false, reason: "budget" };
  }
  return { allowed: true };
}