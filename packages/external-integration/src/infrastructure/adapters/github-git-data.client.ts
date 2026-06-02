/**
 * Low-level GitHub Git Data API client (blobs/trees/commits/refs).
 * Extracted/relocated to enable sharing between GitHubExporterAdapter and
 * commitFiles (RepositoryWriter) without duplication or cross-plane imports.
 */
export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export class GitHubGitDataClient {
  private baseUrl = "https://api.github.com";

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
    const res = (await this.request(
      token,
      "POST",
      `/repos/${owner}/${repo}/git/trees`,
      body,
    )) as { sha: string };
    return res.sha;
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
      if (err instanceof GitHubApiError && err.status === 422) {
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
