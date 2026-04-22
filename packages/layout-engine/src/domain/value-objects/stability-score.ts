export interface StabilityScore {
  readonly value: number;
  readonly violations: number;
  readonly satisfiedConstraints: number;
  readonly totalConstraints: number;
}

export function createStabilityScore(
  satisfiedConstraints: number,
  totalConstraints: number,
  violations: number,
): StabilityScore {
  const value =
    totalConstraints === 0 ? 1 : satisfiedConstraints / totalConstraints;
  return { value, violations, satisfiedConstraints, totalConstraints };
}
