import type { ScanVerdict } from "./types";

/**
 * Map a hexagen scan process exit to the UI verdict.
 *
 * Frozen CLI contract (chore/import-and-scan-cli):
 *   0 — layout written, lint clean
 *   1 — layout written, lint reported violations
 *   2 — could not run (empty / no workspaces / fatal)
 *
 * Anything else — a missing binary (ENOENT), a timeout, an unknown code — is
 * `could-not-run`. Fail-closed: never classify an unknown failure as `pass`.
 */
export function classifyScanExit(
  exitCode: number | string | null,
): ScanVerdict {
  if (exitCode === 0) return "pass";
  if (exitCode === 1) return "violations";
  return "could-not-run";
}
