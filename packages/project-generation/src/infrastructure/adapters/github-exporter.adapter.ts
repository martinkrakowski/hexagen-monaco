import type {
  ExportConfig,
  ExportResult,
  ProjectExporterPort,
} from "../../application/ports/out/project-exporter.port.js";
import fs from "node:fs/promises";
import path from "node:path";

interface FileEntry {
  path: string;
  content: string;
  sha?: string;
}

/**
 * Error carrying the HTTP status from a failed GitHub API call, so callers
 * can branch on status (e.g. 404 → ref does not exist) instead of string
 * matching.
 */
class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export class GitHubExporterAdapter implements ProjectExporterPort {
  private baseUrl = "https://api.github.com";

  async export(
    sourceDirectory: string,
    config: ExportConfig,
  ): Promise<ExportResult> {
    try {
      if (config.destination !== "github" || !config.github) {
        return {
          success: false,
          destinationUrl: "",
          error: "Invalid destination or missing GitHub configuration",
        };
      }

      const { token, owner, repoName, isPrivate } = config.github;

      const createdRepo = await this.createRepo(
        token,
        owner,
        repoName,
        isPrivate,
      );
      if (!createdRepo) {
        return {
          success: false,
          destinationUrl: "",
          error: "Failed to create repository",
        };
      }

      const files = await this.readFiles(sourceDirectory);

      const blobs = await this.createBlobs(token, owner, repoName, files);

      const tree = await this.createTree(token, owner, repoName, blobs);

      // Probe the branch head *before* committing: when it already exists we
      // chain its SHA as the new commit's parent so existing history is
      // preserved (non-fast-forward updates are then impossible). A fresh repo
      // has no ref, so the initial commit is parentless.
      const parentSha = await this.getBranchHeadSha(
        token,
        owner,
        repoName,
        "main",
      );

      const commitSha = await this.createCommit(
        token,
        owner,
        repoName,
        tree,
        parentSha
          ? "Update project: Hexagonal architecture scaffold"
          : "Initial commit: Hexagonal architecture scaffold",
        parentSha ? [parentSha] : [],
      );

      await this.upsertRef(
        token,
        owner,
        repoName,
        "main",
        commitSha,
        parentSha !== null,
      );

      return {
        success: true,
        destinationUrl: `https://github.com/${owner}/${repoName}`,
      };
    } catch (err) {
      return {
        success: false,
        destinationUrl: "",
        error:
          err instanceof Error ? err.message : "Failed to export to GitHub",
      };
    }
  }

  private async request(
    token: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new GitHubApiError(
        response.status,
        `GitHub API error (${response.status}): ${JSON.stringify(error)}`,
      );
    }

    return response.json();
  }

  private async createRepo(
    token: string,
    owner: string,
    repoName: string,
    isPrivate: boolean,
  ): Promise<boolean> {
    try {
      await this.request(token, "POST", "/user/repos", {
        name: repoName,
        private: isPrivate,
        auto_init: false,
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("already exists")) {
        return true;
      }
      throw err;
    }
  }

  private async readFiles(dirPath: string): Promise<FileEntry[]> {
    const files: FileEntry[] = [];

    const traverse = async (currentPath: string, basePath: string) => {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        const relativePath = path.relative(basePath, fullPath);
        if (entry.isDirectory()) {
          await traverse(fullPath, basePath);
        } else {
          const content = await fs.readFile(fullPath);
          const base64 = content.toString("base64");
          files.push({
            path: relativePath,
            content: base64,
          });
        }
      }
    };

    await traverse(dirPath, dirPath);
    return files;
  }

  private async createBlobs(
    token: string,
    owner: string,
    repo: string,
    files: FileEntry[],
  ): Promise<FileEntry[]> {
    const blobPromises = files.map(async (file) => {
      const result = (await this.request(
        token,
        "POST",
        `/repos/${owner}/${repo}/git/blobs`,
        {
          content: file.content,
          encoding: "base64",
        },
      )) as { sha: string };
      return { ...file, sha: result.sha };
    });

    return Promise.all(blobPromises);
  }

  private async createTree(
    token: string,
    owner: string,
    repo: string,
    files: FileEntry[],
  ): Promise<string> {
    const tree = files.map((file) => ({
      path: file.path,
      mode: "100644",
      type: "blob",
      sha: file.sha,
    }));

    const result = (await this.request(
      token,
      "POST",
      `/repos/${owner}/${repo}/git/trees`,
      {
        tree,
      },
    )) as { sha: string };

    return result.sha;
  }

  private async createCommit(
    token: string,
    owner: string,
    repo: string,
    treeSha: string,
    message: string,
    parents: string[] = [],
  ): Promise<string> {
    const result = (await this.request(
      token,
      "POST",
      `/repos/${owner}/${repo}/git/commits`,
      {
        message,
        tree: treeSha,
        ...(parents.length > 0 ? { parents } : {}),
      },
    )) as { sha: string };

    return result.sha;
  }

  /**
   * Point `refs/heads/<branch>` at `commitSha`.
   *
   * - Fresh branch (`branchExisted === false`): the repo has no ref yet, so the
   *   branch is created with `POST /git/refs`.
   * - Existing branch: updated with `force: false`. Because `commitSha` was
   *   built on the branch's head as its parent, this is a fast-forward; if the
   *   branch moved since we probed it, GitHub rejects the non-fast-forward
   *   (422) and we surface a conflict rather than rewriting history.
   */
  private async upsertRef(
    token: string,
    owner: string,
    repo: string,
    branch: string,
    commitSha: string,
    branchExisted: boolean,
  ): Promise<void> {
    if (branchExisted) {
      await this.updateRef(token, owner, repo, branch, commitSha);
      return;
    }

    try {
      await this.request(token, "POST", `/repos/${owner}/${repo}/git/refs`, {
        ref: `refs/heads/${branch}`,
        sha: commitSha,
      });
    } catch (err) {
      // Check-then-act race: the branch was created between our head probe and
      // this POST (concurrent export / double-submit). Our commit is parentless
      // so it cannot fast-forward onto the new history — surface a conflict
      // instead of force-overwriting whatever just landed.
      if (err instanceof GitHubApiError && err.status === 422) {
        throw new GitHubApiError(
          409,
          `Branch '${branch}' was created concurrently during export; ` +
            `re-run the export to build on the new history.`,
        );
      }
      throw err;
    }
  }

  private async updateRef(
    token: string,
    owner: string,
    repo: string,
    branch: string,
    commitSha: string,
  ): Promise<void> {
    await this.request(
      token,
      "PATCH",
      `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
      { sha: commitSha, force: false },
    );
  }

  /**
   * Returns the commit SHA `refs/heads/<branch>` points at, or `null` when the
   * branch does not exist (fresh repo). Used to chain the new commit onto
   * existing history.
   */
  private async getBranchHeadSha(
    token: string,
    owner: string,
    repo: string,
    branch: string,
  ): Promise<string | null> {
    try {
      const res = (await this.request(
        token,
        "GET",
        `/repos/${owner}/${repo}/git/ref/heads/${branch}`,
      )) as { object?: { sha?: string } };
      return res.object?.sha ?? null;
    } catch (err) {
      if (err instanceof GitHubApiError && err.status === 404) {
        return null;
      }
      throw err;
    }
  }
}
