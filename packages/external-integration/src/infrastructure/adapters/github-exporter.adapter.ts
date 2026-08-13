import type {
  ExportConfig,
  ExportResult,
  ProjectExporterPort,
} from "@hexagen/project-generation";
import fs from "node:fs/promises";
import path from "node:path";
import {
  GitHubGitDataClient,
  GitHubApiError,
  isWorkflowFilePath,
  parseOAuthScopesHeader,
  WORKFLOW_SCOPE,
} from "./github-git-data.client.js";

interface FileEntry {
  path: string;
  content: string;
  sha?: string;
}

/**
 * GitHub exporter adapter (relocated from project-generation for
 * infrastructure plane + sharing Git Data client with commit path).
 * Implements the ProjectExporterPort consumed by project-generation use cases.
 */
export class GitHubExporterAdapter implements ProjectExporterPort {
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

      const { token, owner, repoName, isPrivate, commitMessage } =
        config.github;
      const client = new GitHubGitDataClient();

      // Resolve the authenticated user once; the same response carries the
      // token's `x-oauth-scopes` header, so scope detection costs no extra
      // round trip. `scopes === null` = unknown (header absent, e.g. a future
      // GitHub-App-token migration) → FAIL OPEN: proceed as if fully scoped.
      // Safe ONLY because the reactive createTree 404 remap in
      // GitHubGitDataClient backstops the one scope-dependent failure with an
      // actionable typed error instead of the opaque 404.
      const { login: authedLogin, scopes } =
        await this.getAuthenticatedUser(token);

      // createRepo returns the repo's default branch. GitHub initializes an
      // auto_init repo on the account/org default branch, which is not
      // guaranteed to be "main"; targeting the wrong branch would push the
      // scaffold to an orphan "main" while the default branch shows only the
      // auto-init commit. createRepo throws on a real failure (caught below).
      const defaultBranch = await this.createRepo(
        token,
        owner,
        repoName,
        isPrivate,
        authedLogin,
      );

      const allFiles = await this.readFiles(sourceDirectory);

      // Proactive degrade: when scopes are KNOWN to lack `workflow`, GitHub
      // would reject the whole tree over the injected CI workflow. The user's
      // primary intent is "my project on GitHub", so publish the rest and
      // surface one warning per skipped file (filtered BEFORE blob creation —
      // no wasted blob calls) instead of hard-failing.
      const warnings: string[] = [];
      let files = allFiles;
      if (scopes !== null && !scopes.has(WORKFLOW_SCOPE)) {
        files = allFiles.filter((f) => !isWorkflowFilePath(f.path));
        for (const skipped of allFiles) {
          if (!isWorkflowFilePath(skipped.path)) continue;
          warnings.push(
            `Skipped ${skipped.path}: the connected GitHub token lacks the ` +
              "'workflow' scope. Reconnect GitHub to include CI workflow " +
              "files in future publishes.",
          );
        }
      }

      // create blobs via client (base64 already)
      const fileShas: FileEntry[] = [];
      for (const f of files) {
        const sha = await client.createBlob(
          token,
          owner,
          repoName,
          f.content,
          "base64",
        );
        fileShas.push({ ...f, sha });
      }

      const treeEntries = fileShas.map((f) => ({
        path: f.path,
        mode: "100644",
        type: "blob",
        sha: f.sha!,
      }));
      const treeSha = await client.createTree(
        token,
        owner,
        repoName,
        treeEntries,
      );

      const parentSha = await client.getBranchHeadSha(
        token,
        owner,
        repoName,
        defaultBranch,
      );

      const commitSha = await client.createCommit(
        token,
        owner,
        repoName,
        treeSha,
        // Guard at the infra boundary: a non-string commitMessage (e.g. from a
        // malformed payload that bypassed the route) must not reach `.trim()`.
        (typeof commitMessage === "string" ? commitMessage.trim() : "") ||
          (parentSha
            ? "Update project: Hexagonal architecture scaffold"
            : "Initial commit: Hexagonal architecture scaffold"),
        parentSha ? [parentSha] : [],
      );

      await client.upsertRef(
        token,
        owner,
        repoName,
        defaultBranch,
        commitSha,
        parentSha !== null,
      );

      return {
        success: true,
        destinationUrl: `https://github.com/${owner}/${repoName}`,
        defaultBranch,
        ...(warnings.length > 0 ? { warnings } : {}),
      };
    } catch (err) {
      return {
        success: false,
        destinationUrl: "",
        error:
          err instanceof Error ? err.message : "Failed to export to GitHub",
        // Thread the typed failure class (e.g. the reactive workflow-scope
        // remap) through the port so routes never regress to matching on
        // message text.
        ...(err instanceof GitHubApiError && err.code
          ? { errorCode: err.code }
          : {}),
      };
    }
  }

  /**
   * Create the target repo (idempotent on "already exists") and return its
   * default branch. Throws GitHubApiError on a real failure.
   */
  private async createRepo(
    token: string,
    owner: string,
    repoName: string,
    isPrivate: boolean,
    authedLogin: string,
  ): Promise<string> {
    // Inline minimal request to keep test mocks (which spy on global fetch + expect json error shape) happy.
    const base = "https://api.github.com";
    // POST /user/repos always creates under the authenticated user and ignores
    // `owner`. An org-owned export must use POST /orgs/{owner}/repos — otherwise
    // the repo lands under the user while destinationUrl (built from `owner`)
    // points at the org, a location that was never created. The caller resolves
    // the authenticated login (one shared GET /user) to choose the endpoint.
    const endpoint =
      owner && owner.toLowerCase() !== authedLogin.toLowerCase()
        ? `/orgs/${owner}/repos`
        : "/user/repos";
    // auto_init: true creates an initial commit so the repo is non-empty —
    // otherwise the Git Data API rejects blob/tree creation with
    // `409 Git Repository is empty`. That commit lands on the account/org
    // default branch (NOT necessarily "main"), which we return so the caller
    // commits the scaffold onto it instead of an orphan "main".
    const r = await fetch(`${base}${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        name: repoName,
        private: isPrivate,
        auto_init: true,
      }),
    });
    if (r.ok) {
      const repo = (await r.json()) as { default_branch?: string };
      return repo.default_branch || "main";
    }
    const error = await r.json().catch(() => ({}));
    const msg = JSON.stringify(error);
    // Repo already exists (re-publish) — read its current default branch.
    if (msg.includes("already exists")) {
      return this.getDefaultBranch(token, owner, repoName);
    }
    throw new GitHubApiError(
      r.status,
      `GitHub API error (${r.status}): ${msg}`,
    );
  }

  /** Read an existing repo's default branch. */
  private async getDefaultBranch(
    token: string,
    owner: string,
    repoName: string,
  ): Promise<string> {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new GitHubApiError(
        res.status,
        `GitHub API error (${res.status}): ${JSON.stringify(error)}`,
      );
    }
    const data = (await res.json()) as { default_branch?: string };
    return data.default_branch || "main";
  }

  /**
   * Resolve the login of the token's owner (to choose user vs. org repo
   * creation) plus the token's OAuth scopes from the same response's
   * `x-oauth-scopes` header — one round trip serves both needs.
   * `scopes: null` = header absent → unknown (callers fail open; the reactive
   * createTree remap is the backstop).
   */
  private async getAuthenticatedUser(
    token: string,
  ): Promise<{ login: string; scopes: Set<string> | null }> {
    const res = await fetch("https://api.github.com/user", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new GitHubApiError(
        res.status,
        `GitHub API error (${res.status}): ${JSON.stringify(error)}`,
      );
    }
    const data = (await res.json()) as { login?: string };
    if (!data.login) {
      throw new GitHubApiError(
        502,
        "Could not resolve the authenticated GitHub user",
      );
    }
    // Optional-chained: unit-test fetch doubles return header-less responses,
    // and a missing headers bag means the same thing as a missing header.
    const scopes = parseOAuthScopesHeader(res.headers?.get?.("x-oauth-scopes"));
    return { login: data.login, scopes };
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
}
