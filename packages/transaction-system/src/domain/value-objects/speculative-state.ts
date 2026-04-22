/**
 * SpeculativeState - Value object representing the state of a transaction in the speculative execution pipeline.
 */

export type SpeculativeState =
  | { readonly tag: "pending" }
  | { readonly tag: "speculative"; readonly data: unknown }
  | { readonly tag: "confirmed"; readonly data: unknown }
  | { readonly tag: "reconciled"; readonly data: unknown }
  | { readonly tag: "discarded"; readonly reason: string };

/**
 * Creates a pending speculative state.
 */
export const pending = (): SpeculativeState => ({ tag: "pending" });

/**
 * Creates a speculative state with data.
 */
export const speculative = (data: unknown): SpeculativeState => ({
  tag: "speculative",
  data,
});

/**
 * Creates a confirmed state with data.
 */
export const confirmed = (data: unknown): SpeculativeState => ({
  tag: "confirmed",
  data,
});

/**
 * Creates a reconciled state with data.
 */
export const reconciled = (data: unknown): SpeculativeState => ({
  tag: "reconciled",
  data,
});

/**
 * Creates a discarded state with a reason.
 */
export const discarded = (reason: string): SpeculativeState => ({
  tag: "discarded",
  reason,
});

/**
 * Returns true if the speculative state is pending.
 */
export const isPending = (state: SpeculativeState): boolean =>
  state.tag === "pending";

/**
 * Returns true if the speculative state is speculative.
 */
export const isSpeculative = (state: SpeculativeState): boolean =>
  state.tag === "speculative";

/**
 * Returns true if the speculative state is confirmed.
 */
export const isConfirmed = (state: SpeculativeState): boolean =>
  state.tag === "confirmed";

/**
 * Returns true if the speculative state is reconciled.
 */
export const isReconciled = (state: SpeculativeState): boolean =>
  state.tag === "reconciled";

/**
 * Returns true if the speculative state is discarded.
 */
export const isDiscarded = (state: SpeculativeState): boolean =>
  state.tag === "discarded";

/**
 * Extracts the data from a speculative state if it has data, otherwise returns undefined.
 */
export const getData = (state: SpeculativeState): unknown | undefined => {
  if (
    state.tag === "speculative" ||
    state.tag === "confirmed" ||
    state.tag === "reconciled"
  ) {
    return state.data;
  }
  return undefined;
};

/**
 * Extracts the reason from a discarded speculative state, otherwise returns undefined.
 */
export const getReason = (state: SpeculativeState): string | undefined => {
  if (state.tag === "discarded") {
    return state.reason;
  }
  return undefined;
};
