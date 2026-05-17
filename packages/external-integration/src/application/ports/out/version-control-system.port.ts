import type { Result } from "@hexagen/shared";
import type { AssembledManifest } from "@hexagen/shared";

/**
 * Metadata returned after creating a pull request.
 */
export interface PullRequestMetadata {
  readonly prNumber: number;
  readonly prUrl: string;
  readonly title: string;
  readonly createdAt: Date;
  readonly baseBranch: string;
  readonly headBranch: string;
}

/**
 * Error type for version control operations.
 */
export type VcsError = {
  readonly _tag: "VcsError";
  readonly code: "network-timeout" | "auth-failed" | "pr-creation-failed";
  readonly message: string;
  readonly retryable: boolean;
};

/**
 * Port: Version Control System (e.g., GitHub, GitLab).
 * Returns Result<T, E> — never throws.
 */
export interface IVersionControlSystem {
  /**
   * Create a pull request with the proposed manifest change.
   */
  createPullRequest(
    manifest: AssembledManifest,
    intent: string,
  ): Promise<Result<PullRequestMetadata, VcsError>>;
}
