/**
 * Consolidated linter report type definitions used across packages.
 * This is the single source of truth for linter report structures.
 */

export interface LintViolationLike {
  ruleId: string;
  severity: string;
  file: string;
  message: string;
}

export interface LinterReportLike {
  timestamp: string;
  isCompliant: boolean;
  violations: LintViolationLike[];
  scannedFilesCount: number;
}
