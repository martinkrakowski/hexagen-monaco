export interface ReportBaselineEntry {
  rule: string;
  file: string;
  specifier: string;
  reason?: string;
  expires?: string;
}

export interface ReportViolation {
  rule: string;
  file: string;
  specifier: string;
  message: string;
}

export interface RatchetTrendPoint {
  hash: string;
  isoDate: string;
  subject: string;
  entryCount: number;
}

export interface DriftSummary {
  fresh: ReportViolation[];
  baselined: ReportViolation[];
  stale: ReportBaselineEntry[];
  expired: ReportBaselineEntry[];
  collected: boolean;
  /** Set when collect() failed; renderers must not claim a missing binary. */
  failureReason?: string;
}

export interface EngagementReport {
  generatedAt: string;
  workspaceRoot: string;
  systemName: string;
  mermaid: string;
  contextCount: number;
  drift: DriftSummary;
  trend: RatchetTrendPoint[];
  suppressions: ReportBaselineEntry[];
  baselinePresent: boolean;
  layoutPresent: boolean;
}

export interface GitReader {
  logFollow(relativePath: string): Array<{
    hash: string;
    isoDate: string;
    subject: string;
  }>;
  show(hash: string, relativePath: string): string | null;
}

export interface LintCollector {
  collect(): DriftSummary;
}
