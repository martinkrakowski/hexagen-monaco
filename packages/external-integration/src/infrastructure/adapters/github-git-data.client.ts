/**
 * Low-level GitHub Git Data API client (blobs/trees/commits/refs).
 * Extracted/relocated to enable sharing between GitHubExporterAdapter and
 * commitFiles (RepositoryWriter) without duplication or cross-plane imports.
 */

/**
 * Machine-readable failure classes carried alongside the HTTP status, so
 * adapters can map a failure without sentinel-substring matching on message
 * text. Currently only the workflow-scope remap (see `createTree`).
 */
export type GitHubApiErrorCode = "workflow-scope-missing";

export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: GitHubApiErrorCode,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

/** OAuth scope GitHub requires for any write that touches workflow files. */
export const WORKFLOW_SCOPE = "workflow";

/** Directory whose contents require the `workflow` OAuth scope to push. */
const WORKFLOWS_DIR_PREFIX = ".github/workflows/";

/** True for repo-relative paths GitHub treats as Actions workflow files. */
export function isWorkflowFilePath(filePath: string): boolean {
  return filePath.startsWith(WORKFLOWS_DIR_PREFIX);
}

/**
 * Actionable remap for the opaque create-a-tree 404 GitHub returns when the
 * tree contains `.github/workflows/*` files and the token lacks the
 * `workflow` scope.
 *
 * NOTE: keep parenthesized status codes (e.g. "(401)", "(403)") OUT of this
 * text — the export route maps /\((401|403)\)/ in error messages to
 * reauth_required, and this message must never trip that regex.
 */
const WORKFLOW_SCOPE_REMAP_MESSAGE =
  "GitHub rejected this push because it includes GitHub Actions workflow " +
  "files under .github/workflows/ and the connected GitHub token lacks the " +
  "'workflow' OAuth scope. Reconnect GitHub to grant workflow permission, " +
  "then retry.";

/**
 * Parse an `x-oauth-scopes` header value (`", "`-separated, but split
 * defensively on comma + trim) into a scope set.
 *
 * `null`/`undefined` (header absent) → `null` = "unknown"; an empty string is
 * a KNOWN empty scope set (a real, scopeless token), not unknown.
 */
export function parseOAuthScopesHeader(
  headerValue: string | null | undefined,
): Set<string> | null {
  if (headerValue == null) return null;
  return new Set(
    headerValue
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean),
  );
}

export class GitHubGitDataClient {
  private baseUrl = "https://api.github.com";

  /**
   * Resolve the OAuth scopes of a token from the `x-oauth-scopes` response
   * header of a cheap `GET /user` call.
   *
   * Returns `null` for "unknown" when the header is absent (GitHub Apps /
   * fine-grained tokens don't emit it) or the probe itself fails — callers
   * FAIL OPEN on `null` and proceed as if the token were fully scoped. That
   * is safe ONLY because the reactive `createTree` 404 remap below backstops
   * the one known scope-dependent failure: if the optimism was wrong, the
   * tree creation still fails into the actionable workflow-scope error
   * instead of an opaque 404.
   */
  async getTokenScopes(token: string): Promise<Set<string> | null> {
    try {
      const response = await fetch(`${this.baseUrl}/user`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      return parseOAuthScopesHeader(response.headers?.get("x-oauth-scopes"));
    } catch {
      // Network/transport failure: scopes unknown → fail open (see above).
      return null;
    }
  }

  async createBlob(
    token: string,
    owner: string,
    repo: string,
    content: string,
    encoding: "utf-8" | "base64" = "base64",
  ): Promise<string> {
    const res = (await this.request(
      token,
      "POST",
      `/repos/${owner}/${repo}/git/blobs`,
      {
        content,
        encoding,
      },
    )) as { sha: string };
    return res.sha;
  }

  async createTree(
    token: string,
    owner: string,
    repo: string,
    tree: Array<{
      path: string;
      mode: string;
      type: string;
      sha?: string;
      content?: string;
    }>,
    baseTree?: string,
  ): Promise<string> {
    const body: { tree: typeof tree; base_tree?: string } = { tree };
    if (baseTree) body.base_tree = baseTree;
    try {
      const res = (await this.request(
        token,
        "POST",
        `/repos/${owner}/${repo}/git/trees`,
        body,
      )) as { sha: string };
      return res.sha;
    } catch (err) {
      // Reactive backstop for the fail-open proactive scope check: GitHub
      // rejects tree creation with a bare 404 "Not Found" when the tree
      // contains `.github/workflows/*` paths and the token lacks the
      // `workflow` OAuth scope. The 404 body does NOT echo the submitted
      // paths (GitHubApiError carries only status + message), so the remap is
      // keyed on the LOCAL `tree` array we just submitted — did WE include
      // workflow files? — never on GitHub's message text.
      if (
        err instanceof GitHubApiError &&
        err.status === 404 &&
        tree.some((entry) => isWorkflowFilePath(entry.path))
      ) {
        throw new GitHubApiError(
          err.status,
          WORKFLOW_SCOPE_REMAP_MESSAGE,
          "workflow-scope-missing",
        );
      }
      throw err;
    }
  }

  async createCommit(
    token: string,
    owner: string,
    repo: string,
    treeSha: string,
    message: string,
    parents: string[] = [],
  ): Promise<string> {
    const res = (await this.request(
      token,
      "POST",
      `/repos/${owner}/${repo}/git/commits`,
      {
        message,
        tree: treeSha,
        ...(parents.length > 0 ? { parents } : {}),
      },
    )) as { sha: string };
    return res.sha;
  }

  /**
   * Resolve the tree SHA of a commit (used as `base_tree` for incremental commits).
   */
  async getCommitTreeSha(
    token: string,
    owner: string,
    repo: string,
    commitSha: string,
  ): Promise<string | undefined> {
    const res = (await this.request(
      token,
      "GET",
      `/repos/${owner}/${repo}/git/commits/${commitSha}`,
    )) as { tree?: { sha?: string } };
    return res.tree?.sha;
  }

  async getBranchHeadSha(
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

  async upsertRef(
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
      // GitHub returns 422 for many validation failures; only the specific
      // "Reference already exists" case means the branch was created
      // concurrently. Remap just that to a 409 conflict; rethrow other 422s.
      if (
        err instanceof GitHubApiError &&
        err.status === 422 &&
        /already exists/i.test(err.message)
      ) {
        throw new GitHubApiError(
          409,
          `Branch '${branch}' was created concurrently; re-run to build on new history.`,
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
      {
        sha: commitSha,
        force: false,
      },
    );
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
      let detail = "";
      try {
        const errJson = await response.json();
        detail = JSON.stringify(errJson);
      } catch {
        detail = "parse error";
      }
      throw new GitHubApiError(
        response.status,
        `GitHub API error (${response.status}): ${detail}`,
      );
    }

    return response.json();
  }
}
