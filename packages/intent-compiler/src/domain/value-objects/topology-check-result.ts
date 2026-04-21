export interface TopologyCheckResult {
  readonly isValid: boolean;
  readonly violations: string[];
}