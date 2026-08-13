import type {
  RepositoryLink,
  RepositoryWriterPort,
  CommitResult,
  RepositoryWriterError,
} from "../../application/ports/out/repository-writer.port.js";
import {
  GitHubGitDataClient,
  GitHubApiError,
  isWorkflowFilePath,
  WORKFLOW_SCOPE,
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

      // 0. Workflow-scope preflight — only when the push actually contains
      // `.github/workflows/*` files (the common path pays no extra round
      // trip). GitHub rejects such trees with an opaque 404 when the token
      // lacks the `workflow` scope, so fail BEFORE any writes with a typed,
      // actionable error. The user explicitly chose these files, so unlike
      // the scaffold export we never silently drop them. `null` scopes =
      // unknown → FAIL OPEN (proceed as if scoped) — safe ONLY because the
      // reactive createTree 404 remap in GitHubGitDataClient backstops it
      // with the same `workflow-scope-missing` code.
      const workflowFiles = Object.keys(files).filter(isWorkflowFilePath);
      if (workflowFiles.length > 0) {
        const scopes = await client.getTokenScopes(token);
        if (scopes !== null && !scopes.has(WORKFLOW_SCOPE)) {
          return {
            success: false,
            error: {
              code: "workflow-scope-missing",
              message:
                `Pushing ${workflowFiles.join(", ")} requires the 'workflow' ` +
                "OAuth scope, which the connected GitHub token lacks. " +
                "Reconnect GitHub to grant workflow permission, then retry.",
            },
          };
        }
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
        // Reactive path (scopes were unknown at preflight, so we failed open):
        // the client's createTree remap carries a typed code — surface it
        // before any status-based mapping (its status is GitHub's raw 404).
        if (err.code === "workflow-scope-missing") {
          return {
            success: false,
            error: { code: "workflow-scope-missing", message: err.message },
          };
        }
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
