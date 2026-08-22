import type { Result } from "@hexagen/shared";
import type {
  OpenPullRequestRequest,
  PullRequestOpenerError,
  PullRequestOpenerPort,
} from "../../application/ports/out/pull-request-opener.port.js";
import type { PullRequestMetadata } from "../../application/ports/out/version-control-system.port.js";

/**
 * In-memory double for `PullRequestOpenerPort`. Records calls and returns a
 * synthetic pull request, so consumers can be tested without a network.
 *
 * Parity rule (`.agents/TESTING.md`): this implements exactly the port's
 * surface — one method, same signature — and `yarn typecheck:test` is what
 * enforces that.
 *
 * The double deliberately does NOT re-implement the adapter's safety checks
 * (kill switch, self-owned enforcement, path validation). Those are the
 * adapter's contract and are tested against the adapter; a double that
 * duplicated them would let a consumer's test pass against behaviour the real
 * adapter no longer has.
 */
export class InMemoryPullRequestOpener implements PullRequestOpenerPort {
  public readonly requests: OpenPullRequestRequest[] = [];

  /** Set to make the next and subsequent calls fail with this error. */
  public failWith: PullRequestOpenerError | null = null;

  async openPullRequest(
    request: OpenPullRequestRequest,
  ): Promise<Result<PullRequestMetadata, PullRequestOpenerError>> {
    // Snapshot by value so later mutation of the caller's objects cannot
    // retroactively rewrite what we recorded (which would mask wiring bugs).
    this.requests.push({
      ...request,
      repository: { ...request.repository },
      files: request.files.map((file) => ({ ...file })),
    });

    if (this.failWith !== null) {
      return { success: false, error: this.failWith };
    }

    const prNumber = this.requests.length;
    const { owner, repo } = request.repository;
    return {
      success: true,
      value: {
        prNumber,
        prUrl: `https://example.com/${owner}/${repo}/pull/${prNumber}`,
        title: request.title,
        createdAt: new Date(0),
        baseBranch: "main",
        headBranch: `hexagen/${request.branchSlug ?? "conformance-gate"}-test`,
      },
    };
  }
}
