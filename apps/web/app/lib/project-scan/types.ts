/**
 * Contract between POST /api/projects/scan and the import-scan UI.
 *
 * Verdicts are classified from the hexagen scan exit code (0 / 1 / 2). A
 * missing binary or a spawn failure is `could-not-run`, never a silent pass.
 * This module is client-safe: no `node:` imports.
 */

export type ScanVerdict = "pass" | "violations" | "could-not-run";

export interface ProjectScanResponse {
  readonly verdict: ScanVerdict;
  readonly exitCode: number | null;
  readonly projectName: string;
  readonly layoutExcerpt: string | null;
  readonly filesScanned: number | null;
  readonly reportMarkdown: string | null;
  readonly errorMessage: string | null;
}
