/**
 * Result of evaluating a manifest against organizational policies.
 * Uses Result<T, E> pattern — never throws.
 */
export type PolicyViolationError = {
  readonly _tag: "PolicyViolationError";
  readonly ruleId: string;
  readonly ruleName: string;
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly message: string;
  readonly manifestPath?: string;
};

export interface ComplianceReport {
  readonly _tag: "ComplianceReport";
  readonly reportId: string;
  readonly evaluatedAt: Date;
  readonly manifestName: string;
  readonly passed: boolean;
  readonly violations: PolicyViolationError[];
  readonly summary: string;
}

/**
 * Factory: create a passing report.
 */
export function createPassingReport(
  manifestName: string,
  summary?: string,
): ComplianceReport {
  return {
    _tag: "ComplianceReport",
    reportId: `report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    evaluatedAt: new Date(),
    manifestName,
    passed: true,
    violations: [],
    summary: summary ?? `All policy checks passed for ${manifestName}`,
  };
}

/**
 * Factory: create a failing report.
 */
export function createFailingReport(
  manifestName: string,
  violations: PolicyViolationError[],
): ComplianceReport {
  return {
    _tag: "ComplianceReport",
    reportId: `report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    evaluatedAt: new Date(),
    manifestName,
    passed: false,
    violations,
    summary: `${violations.length} policy violation(s) found in ${manifestName}`,
  };
}
