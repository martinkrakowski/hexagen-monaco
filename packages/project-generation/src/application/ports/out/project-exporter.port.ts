export type ExportDestination = "archive" | "github";

export interface GitHubExportConfig {
  token: string;
  owner: string;
  repoName: string;
  isPrivate: boolean;
  /** Optional custom commit message; the adapter falls back to a default. */
  commitMessage?: string;
}

export interface ExportConfig {
  destination: ExportDestination;
  github?: GitHubExportConfig;
}

/**
 * Machine-readable export failure classes, threaded through the port so API
 * routes can map a failure to a specific HTTP response without
 * sentinel-substring matching on the message text.
 * `workflow-scope-missing` = GitHub rejected the commit tree because it
 * contained `.github/workflows/*` files and the OAuth token lacks the
 * `workflow` scope.
 */
export type ExportErrorCode = "workflow-scope-missing";

export interface ExportResult {
  success: boolean;
  destinationUrl: string;
  /** Branch the project was committed to (GitHub export) — the repo's actual default branch. */
  defaultBranch?: string;
  error?: string;
  /** Typed failure class accompanying `error` (see {@link ExportErrorCode}). */
  errorCode?: ExportErrorCode;
  /**
   * Non-fatal notices from the exporter (e.g. a workflow file skipped because
   * the token lacks the `workflow` scope). Additive: merged into the
   * generation output's warnings for the UI.
   */
  warnings?: string[];
}

export interface ProjectExporterPort {
  export(sourceDirectory: string, config: ExportConfig): Promise<ExportResult>;
}
