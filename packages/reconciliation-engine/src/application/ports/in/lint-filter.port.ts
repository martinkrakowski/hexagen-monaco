import type { Patch } from "../../../domain/llm-response.js";

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

export interface LintFilterPort {
  filterPatches(patches: Patch[], report: LinterReportLike): Patch[];
}
