import type { SyncRunSummary } from "../../results.js";

/**
 * Schema version of the machine-readable line `hexagen sync --check --json`
 * prints (lane H2b). Bump when the shape changes.
 */
export const SYNC_CHECK_JSON_SCHEMA_VERSION = 1;

/** Machine-readable status of a `sync --check` run. */
export type SyncCheckStatus = "converged" | "drift" | "could-not-run";

/**
 * The one JSON line `hexagen sync --check --json` writes to stdout. Keys are
 * documented in this order; `pending`, `errors` and `manifestMissing` are
 * `null` only on the fatal path, where no summary exists to report.
 */
export interface SyncCheckJson {
  schemaVersion: number;
  command: "sync --check";
  status: SyncCheckStatus;
  exitCode: 0 | 1;
  pending: {
    created: number;
    updated: number;
    deleted: number;
    total: number;
  } | null;
  errors: number | null;
  manifestMissing: boolean | null;
  reason: string | null;
}

/**
 * Build the JSON payload for `sync --check --json`. Exactly one of `summary` /
 * `fatalMessage` is normally defined; when both are undefined the run produced
 * no summary at all, which is treated as fatal (precedence rule 1).
 *
 * Precedence (the contract this lane implements):
 * 1. a fatal error (or no summary) → `could-not-run`, every summary field
 *    `null`, `reason` = the error message (or "sync produced no summary");
 * 2. `manifestMissing` → `could-not-run`, `reason` "manifest not found";
 * 3. `errors > 0` → `could-not-run`, `reason` "<n> generator failure(s)";
 * 4. `totalOps > 0` → `drift`;
 * 5. otherwise → `converged`.
 *
 * `exitCode` is the process exit code: `0` only for `converged`, `1`
 * otherwise. The exit-code decision stays in cli.ts (A1 doctrine); this pure
 * builder only mirrors it so the printed line and the process agree.
 */
export function buildSyncCheckJson(
  summary: SyncRunSummary | undefined,
  fatalMessage: string | undefined,
): SyncCheckJson {
  if (summary === undefined || fatalMessage !== undefined) {
    return {
      schemaVersion: SYNC_CHECK_JSON_SCHEMA_VERSION,
      command: "sync --check",
      status: "could-not-run",
      exitCode: 1,
      pending: null,
      errors: null,
      manifestMissing: null,
      reason: fatalMessage ?? "sync produced no summary",
    };
  }

  const pending = {
    created: summary.created,
    updated: summary.updated,
    deleted: summary.deleted,
    total: summary.totalOps,
  };

  if (summary.manifestMissing) {
    return {
      schemaVersion: SYNC_CHECK_JSON_SCHEMA_VERSION,
      command: "sync --check",
      status: "could-not-run",
      exitCode: 1,
      pending,
      errors: summary.errors,
      manifestMissing: true,
      reason: "manifest not found",
    };
  }

  if (summary.errors > 0) {
    return {
      schemaVersion: SYNC_CHECK_JSON_SCHEMA_VERSION,
      command: "sync --check",
      status: "could-not-run",
      exitCode: 1,
      pending,
      errors: summary.errors,
      manifestMissing: false,
      reason: `${summary.errors} generator failure(s)`,
    };
  }

  if (summary.totalOps > 0) {
    return {
      schemaVersion: SYNC_CHECK_JSON_SCHEMA_VERSION,
      command: "sync --check",
      status: "drift",
      exitCode: 1,
      pending,
      errors: summary.errors,
      manifestMissing: false,
      reason: null,
    };
  }

  return {
    schemaVersion: SYNC_CHECK_JSON_SCHEMA_VERSION,
    command: "sync --check",
    status: "converged",
    exitCode: 0,
    pending,
    errors: summary.errors,
    manifestMissing: false,
    reason: null,
  };
}
