/**
 * Metadata returned after creating a pull request.
 *
 * Retained as a live cross-package type: `apps/web` imports it as the response
 * shape of the propose-PR client path. The `IVersionControlSystem` port and its
 * only implementation (`GitHubVcsAdapter`) were removed as dead code — the
 * adapter hardcoded `owner:'organization'`, referenced a branch it never
 * created (AUD-009), and had zero live consumers.
 */
export interface PullRequestMetadata {
  readonly prNumber: number;
  readonly prUrl: string;
  readonly title: string;
  readonly createdAt: Date;
  readonly baseBranch: string;
  readonly headBranch: string;
}
