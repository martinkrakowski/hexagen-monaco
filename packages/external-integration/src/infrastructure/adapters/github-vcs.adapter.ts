import type { IVersionControlSystem } from "../../application/ports/out/version-control-system.port.js";
import type { PullRequestMetadata } from "../../application/ports/out/version-control-system.port.js";
import type { VcsError } from "../../application/ports/out/version-control-system.port.js";
import type { AssembledManifest } from "@hexagen/shared";
import { Octokit } from "@octokit/rest";
import type { Result } from "@hexagen/shared";

export class GitHubVcsAdapter implements IVersionControlSystem {
  private readonly octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async createPullRequest(
    manifest: AssembledManifest,
    intent: string,
  ): Promise<Result<PullRequestMetadata, VcsError>> {
    try {
      const headBranch = `feature/manifest-${Date.now()}`;
      const response = await this.octokit.pulls.create({
        owner: "organization", // TODO: make configurable
        repo: "manifest-changes",
        title: `Manifest Change: ${intent}`,
        body: "Proposed manifest change",
        head: headBranch,
        base: "main",
      });

      return {
        success: true,
        value: {
          prNumber: response.data.number,
          prUrl: response.data.html_url,
          title: response.data.title,
          createdAt: new Date(),
          baseBranch: "main",
          headBranch,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          _tag: "VcsError",
          code: "pr-creation-failed",
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        },
      };
    }
  }
}
