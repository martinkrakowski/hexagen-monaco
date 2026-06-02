import type {
  RepositoryLink,
  RepositoryWriterPort,
  CommitResult,
  RepositoryWriterError,
} from "../../application/ports/out/repository-writer.port.js";
import {
  GitHubGitDataClient,
  GitHubApiError,
} from "./github-git-data.client.js";
import type { Result } from "@hexagen/shared";

/**
 * GitHub implementation of RepositoryWriterPort using the shared Git Data client.
 * Supports partial file commits (create/update) on a branch, fast-forward only.
 */
export class GitHubRepositoryWriterAdapter implements RepositoryWriterPort {
  async commitFiles(
    link: RepositoryLink,
    files: Record<string, string>,
    message: string,
    token: string,
  ): Promise<Result<CommitResult, RepositoryWriterError>> {
    const client = new GitHubGitDataClient();
    const { owner, repo, branch = "main" } = link;

    try {
      if (Object.keys(files).length === 0) {
        return {
          success: false,
          error: { code: "unknown", message: "No files to commit" },
        };
      }

      // 1. Get current head for parent + base tree
      const headSha = await client.getBranchHeadSha(token, owner, repo, branch);
      const baseTreeSha = headSha
        ? await client.getCommitTreeSha(token, owner, repo, headSha)
        : undefined;

      // 2. Create blobs for provided files (text -> base64)
      const treeEntries = [];
      for (const [p, content] of Object.entries(files)) {
        const b64 = Buffer.from(content, "utf8").toString("base64");
        const blobSha = await client.createBlob(
          token,
          owner,
          repo,
          b64,
          "base64",
        );
        treeEntries.push({
          path: p,
          mode: "100644",
          type: "blob",
          sha: blobSha,
        });
      }

      // 3. Create tree (base on current if any, override the paths)
      const newTreeSha = await client.createTree(
        token,
        owner,
        repo,
        treeEntries,
        baseTreeSha,
      );

      // 4. Create commit
      const parents = headSha ? [headSha] : [];
      const commitMessage = message || "Update from editor";
      const newCommitSha = await client.createCommit(
        token,
        owner,
        repo,
        newTreeSha,
        commitMessage,
        parents,
      );

      // 5. Fast-forward ref
      await client.upsertRef(
        token,
        owner,
        repo,
        branch,
        newCommitSha,
        headSha !== null,
      );

      const commitUrl = `https://github.com/${owner}/${repo}/commit/${newCommitSha}`;
      return {
        success: true,
        value: { commitSha: newCommitSha, commitUrl },
      };
    } catch (err) {
      if (err instanceof GitHubApiError) {
        if (err.status === 401 || err.status === 403) {
          return {
            success: false,
            error: {
              code: "auth-failed",
              message: `GitHub auth error (${err.status})`,
            },
          };
        }
        if (err.status === 409 || err.status === 422) {
          return {
            success: false,
            error: { code: "conflict", message: err.message },
          };
        }
        if (err.status === 429) {
          return {
            success: false,
            error: { code: "rate-limit", message: err.message },
          };
        }
      }
      return {
        success: false,
        error: {
          code: "unknown",
          message: err instanceof Error ? err.message : "Commit failed",
        },
      };
    }
  }
}
