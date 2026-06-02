import type { Result } from "@hexagen/shared";

/**
 * Link to a GitHub repo for write operations (from persisted SavedProject.githubLink).
 */
export interface RepositoryLink {
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;
  readonly defaultBranch?: string;
  readonly lastCommitSha?: string | null;
  readonly htmlUrl?: string;
}

/**
 * Result of a commit operation.
 */
export interface CommitResult {
  readonly commitSha: string;
  readonly commitUrl: string;
}

/**
 * Error codes for repository writer (map 401/403 from GitHub to reauth_required at route).
 */
export type RepositoryWriterError =
  | { readonly code: "auth-failed"; readonly message: string }
  | { readonly code: "conflict"; readonly message: string }
  | { readonly code: "rate-limit"; readonly message: string }
  | { readonly code: "network"; readonly message: string }
  | { readonly code: "unknown"; readonly message: string };

/**
 * Port for writing file sets to a repository (used by editor push and export).
 * Token is per-call (never stored in long-lived adapter).
 * files: Record<path, content> (text content; impl base64-encodes for Git blobs).
 */
export interface RepositoryWriterPort {
  commitFiles(
    link: RepositoryLink,
    files: Record<string, string>,
    message: string,
    token: string,
  ): Promise<Result<CommitResult, RepositoryWriterError>>;
}
