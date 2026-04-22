/**
 * BackpressureSignal - Value object representing signals for backpressure handling.
 */

export type BackpressureSignal =
  | { readonly tag: "none" }
  | { readonly tag: "coalesce"; readonly intentIds: string[] }
  | { readonly tag: "drop"; readonly reason: string }
  | { readonly tag: "degrade_fidelity"; readonly level: number }; // 0-1 scale

/**
 * Creates a no backpressure signal.
 */
export const none = (): BackpressureSignal => ({ tag: "none" });

/**
 * Creates a coalesce signal with the intent IDs to coalesce.
 */
export const coalesce = (intentIds: string[]): BackpressureSignal => ({
  tag: "coalesce",
  intentIds,
});

/**
 * Creates a drop signal with a reason.
 */
export const drop = (reason: string): BackpressureSignal => ({
  tag: "drop",
  reason,
});

/**
 * Creates a degrade fidelity signal with a level (0-1).
 */
export const degradeFidelity = (level: number): BackpressureSignal => ({
  tag: "degrade_fidelity",
  level: Math.max(0, Math.min(1, level)), // Clamp to 0-1 range
});

/**
 * Returns true if the backpressure signal is none.
 */
export const isNone = (signal: BackpressureSignal): boolean =>
  signal.tag === "none";

/**
 * Returns true if the backpressure signal is coalesce.
 */
export const isCoalesce = (signal: BackpressureSignal): boolean =>
  signal.tag === "coalesce";

/**
 * Returns true if the backpressure signal is drop.
 */
export const isDrop = (signal: BackpressureSignal): boolean =>
  signal.tag === "drop";

/**
 * Returns true if the backpressure signal is degrade_fidelity.
 */
export const isDegradeFidelity = (signal: BackpressureSignal): boolean =>
  signal.tag === "degrade_fidelity";

/**
 * Extracts the intent IDs from a coalesce signal, otherwise returns empty array.
 */
export const getCoalesceIntentIds = (signal: BackpressureSignal): string[] => {
  if (signal.tag === "coalesce") {
    return signal.intentIds;
  }
  return [];
};

/**
 * Extracts the reason from a drop signal, otherwise returns undefined.
 */
export const getDropReason = (
  signal: BackpressureSignal,
): string | undefined => {
  if (signal.tag === "drop") {
    return signal.reason;
  }
  return undefined;
};

/**
 * Extracts the level from a degrade_fidelity signal, otherwise returns undefined.
 */
export const getDegradeFidelityLevel = (
  signal: BackpressureSignal,
): number | undefined => {
  if (signal.tag === "degrade_fidelity") {
    return signal.level;
  }
  return undefined;
};
