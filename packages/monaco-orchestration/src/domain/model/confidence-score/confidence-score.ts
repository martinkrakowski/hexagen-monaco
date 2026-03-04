export type ConfidenceScore = number & { __brand: 'ConfidenceScore' };

export function createConfidenceScore(value: number): ConfidenceScore {
  if (value < 0 || value > 1) {
    throw new Error('Confidence must be between 0 and 1');
  }
  return value as ConfidenceScore;
}
