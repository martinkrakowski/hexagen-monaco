import { describe, it, afterEach } from "vitest";
import assert from "node:assert";
import { GitHubRepositoryWriterAdapter } from "../../infrastructure/adapters/github-repository-writer.adapter.js";

interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
}

interface MockRoute {
  /** Match against `${METHOD} ${path}` (path without the API base URL). */
  match: (method: string, path: string) => boolean;
  status: number;
  body: unknown;
  /** Response headers (e.g. `x-oauth-scopes` for scope-preflight tests). */
  headers?: Record<string, string>;
}

/**
 * Ordered, consume-once `fetch` stand-in (same shape as the exporter test):
 * each call must match the route at the head of the queue, so a regression in
 * the head→tree→blobs→tree→commit→ref ordering is caught, not swallowed.
 */
function installFetchMock(routes: MockRoute[]): {
  calls: RecordedCall[];
  restore: () => void;
} {
  const calls: RecordedCall[] = [];
  const original = globalThis.fetch;
  const remaining = [...routes];

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const apiPath = url.replace("https://api.github.com", "");
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ method, path: apiPath, body });

    const route = remaining[0];
    if (!route || !route.match(method, apiPath)) {
      throw new Error(`Unexpected request: ${method} ${apiPath}`);
    }
    remaining.shift();
    const status = route.status;
    return {
      ok: status >= 200 && status < 300,
      status,
      // Empty Headers when unspecified: `x-oauth-scopes` absent = scopes
      // unknown, so pre-existing tests exercise the fail-open path unchanged.
      headers: new Headers(route.headers ?? {}),
      json: async () => route.body,
    } as Response;
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
      assert.strictEqual(
        remaining.length,
        0,
        `Unused mocked routes remain: ${remaining.length}`,
      );
    },
  };
}

const route = (
  method: string,
  pathFragment: string,
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): MockRoute => ({
  match: (m, p) => m === method && p.includes(pathFragment),
  status,
  body,
  headers,
});

const link = { owner: "octocat", repo: "hexagen-app", branch: "main" };

describe("GitHubRepositoryWriterAdapter", () => {
  let restore: (() => void) | null = null;

  afterEach(() => {
    restore?.();
    restore = null;
  });

  it("chains the branch head as parent and fast-forwards (force:false) on an existing branch", async () => {
    const mock = installFetchMock([
      route("GET", "/git/ref/heads/main", 200, { object: { sha: "head1" } }),
      route("GET", "/git/commits/head1", 200, { tree: { sha: "basetree1" } }),
      route("POST", "/git/blobs", 201, { sha: "blob1" }),
      route("POST", "/git/trees", 201, { sha: "tree1" }),
      route("POST", "/git/commits", 201, { sha: "newcommit1" }),
      route("PATCH", "/git/refs/heads/main", 200, { ref: "refs/heads/main" }),
    ]);
    restore = mock.restore;

    const result = await new GitHubRepositoryWriterAdapter().commitFiles(
      link,
      { "src/index.ts": "export {};" },
      "test: editor push",
      "ghp_test",
    );

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.commitSha, "newcommit1");
      assert.strictEqual(
        result.value.commitUrl,
        "https://github.com/octocat/hexagen-app/commit/newcommit1",
      );
    }
    // Tree is based on the head commit's tree, and the commit chains the head.
    const tree = mock.calls.find((c) => c.path.endsWith("/git/trees"));
    assert.strictEqual(
      (tree!.body as { base_tree?: string }).base_tree,
      "basetree1",
    );
    const commit = mock.calls.find((c) => c.path.endsWith("/git/commits"));
    assert.deepStrictEqual((commit!.body as { parents?: string[] }).parents, [
      "head1",
    ]);
    const patch = mock.calls.find((c) => c.method === "PATCH");
    assert.deepStrictEqual(patch?.body, { sha: "newcommit1", force: false });
  });

  it("creates a parentless commit + POST ref when the branch does not exist yet", async () => {
    const mock = installFetchMock([
      route("GET", "/git/ref/heads/main", 404, { message: "Not Found" }),
      route("POST", "/git/blobs", 201, { sha: "blob1" }),
      route("POST", "/git/trees", 201, { sha: "tree1" }),
      route("POST", "/git/commits", 201, { sha: "newcommit2" }),
      route("POST", "/git/refs", 201, { ref: "refs/heads/main" }),
    ]);
    restore = mock.restore;

    const result = await new GitHubRepositoryWriterAdapter().commitFiles(
      link,
      { "a.txt": "1" },
      "init",
      "ghp_test",
    );

    assert.strictEqual(result.success, true);
    // No base_tree probe and no base_tree on the tree for a fresh branch.
    assert.ok(
      !mock.calls.some(
        (c) => c.method === "GET" && c.path.includes("/git/commits/"),
      ),
      "should not fetch a base tree when the branch is absent",
    );
    const tree = mock.calls.find((c) => c.path.endsWith("/git/trees"));
    assert.ok(!("base_tree" in (tree!.body as Record<string, unknown>)));
    const commit = mock.calls.find((c) => c.path.endsWith("/git/commits"));
    assert.ok(!("parents" in (commit!.body as Record<string, unknown>)));
    assert.ok(
      !mock.calls.some((c) => c.method === "PATCH"),
      "must POST (not PATCH) a ref that does not exist",
    );
  });

  it("returns an unknown error and makes no requests when there are no files", async () => {
    const mock = installFetchMock([]);
    restore = mock.restore;

    const result = await new GitHubRepositoryWriterAdapter().commitFiles(
      link,
      {},
      "noop",
      "ghp_test",
    );

    assert.strictEqual(result.success, false);
    if (!result.success) assert.strictEqual(result.error.code, "unknown");
    assert.strictEqual(mock.calls.length, 0);
  });

  for (const status of [401, 403]) {
    it(`maps GitHub ${status} to auth-failed`, async () => {
      const mock = installFetchMock([
        route("GET", "/git/ref/heads/main", status, { message: "nope" }),
      ]);
      restore = mock.restore;

      const result = await new GitHubRepositoryWriterAdapter().commitFiles(
        link,
        { "a.txt": "1" },
        "msg",
        "ghp_test",
      );

      assert.strictEqual(result.success, false);
      if (!result.success) assert.strictEqual(result.error.code, "auth-failed");
    });
  }

  it("maps a 422 on a write to conflict", async () => {
    const mock = installFetchMock([
      route("GET", "/git/ref/heads/main", 200, { object: { sha: "head1" } }),
      route("GET", "/git/commits/head1", 200, { tree: { sha: "basetree1" } }),
      route("POST", "/git/blobs", 422, { message: "Validation failed" }),
    ]);
    restore = mock.restore;

    const result = await new GitHubRepositoryWriterAdapter().commitFiles(
      link,
      { "a.txt": "1" },
      "msg",
      "ghp_test",
    );

    assert.strictEqual(result.success, false);
    if (!result.success) assert.strictEqual(result.error.code, "conflict");
  });

  it("maps a 429 to rate-limit", async () => {
    const mock = installFetchMock([
      route("GET", "/git/ref/heads/main", 200, { object: { sha: "head1" } }),
      route("GET", "/git/commits/head1", 200, { tree: { sha: "basetree1" } }),
      route("POST", "/git/blobs", 429, { message: "secondary rate limit" }),
    ]);
    restore = mock.restore;

    const result = await new GitHubRepositoryWriterAdapter().commitFiles(
      link,
      { "a.txt": "1" },
      "msg",
      "ghp_test",
    );

    assert.strictEqual(result.success, false);
    if (!result.success) assert.strictEqual(result.error.code, "rate-limit");
  });

  describe("workflow OAuth-scope preflight", () => {
    const workflowFiles = {
      ".github/workflows/ci.yml": "name: ci\n",
      "src/index.ts": "export {};",
    };

    it("returns workflow-scope-missing with ZERO write calls when scopes are known to lack 'workflow'", async () => {
      const mock = installFetchMock([
        // Preflight probe only — no ref/blob/tree/commit calls may follow.
        route(
          "GET",
          "/user",
          200,
          { login: "octocat" },
          {
            "x-oauth-scopes": "read:user, user:email, repo",
          },
        ),
      ]);
      restore = mock.restore;

      const result = await new GitHubRepositoryWriterAdapter().commitFiles(
        link,
        workflowFiles,
        "ci: add workflow",
        "ghp_test",
      );

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.strictEqual(result.error.code, "workflow-scope-missing");
        assert.match(result.error.message, /\.github\/workflows\/ci\.yml/);
        assert.match(result.error.message, /workflow/);
      }
      assert.strictEqual(mock.calls.length, 1, "only the scope probe may run");
      assert.ok(
        !mock.calls.some((c) => c.method !== "GET"),
        "no writes before the preflight verdict",
      );
    });

    it("commits normally when the token has the 'workflow' scope", async () => {
      const mock = installFetchMock([
        route(
          "GET",
          "/user",
          200,
          { login: "octocat" },
          {
            "x-oauth-scopes": "read:user, user:email, repo, workflow",
          },
        ),
        route("GET", "/git/ref/heads/main", 200, { object: { sha: "head1" } }),
        route("GET", "/git/commits/head1", 200, { tree: { sha: "basetree1" } }),
        route("POST", "/git/blobs", 201, { sha: "blob1" }),
        route("POST", "/git/blobs", 201, { sha: "blob2" }),
        route("POST", "/git/trees", 201, { sha: "tree1" }),
        route("POST", "/git/commits", 201, { sha: "wfcommit" }),
        route("PATCH", "/git/refs/heads/main", 200, { ref: "refs/heads/main" }),
      ]);
      restore = mock.restore;

      const result = await new GitHubRepositoryWriterAdapter().commitFiles(
        link,
        workflowFiles,
        "ci: add workflow",
        "ghp_test",
      );

      assert.strictEqual(result.success, true);
      if (result.success)
        assert.strictEqual(result.value.commitSha, "wfcommit");
    });

    it("fails open when the scope header is absent, then remaps a createTree 404 to workflow-scope-missing", async () => {
      const mock = installFetchMock([
        // Probe without x-oauth-scopes → unknown → proceed (fail open)...
        route("GET", "/user", 200, { login: "octocat" }),
        route("GET", "/git/ref/heads/main", 200, { object: { sha: "head1" } }),
        route("GET", "/git/commits/head1", 200, { tree: { sha: "basetree1" } }),
        route("POST", "/git/blobs", 201, { sha: "blob1" }),
        route("POST", "/git/blobs", 201, { sha: "blob2" }),
        // ...and the reactive remap backstops the optimism: GitHub 404s the
        // tree because it contains a workflow file.
        route("POST", "/git/trees", 404, { message: "Not Found" }),
      ]);
      restore = mock.restore;

      const result = await new GitHubRepositoryWriterAdapter().commitFiles(
        link,
        workflowFiles,
        "ci: add workflow",
        "ghp_test",
      );

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.strictEqual(result.error.code, "workflow-scope-missing");
        // No parenthesized status code in the remap text (route regex guard).
        assert.doesNotMatch(result.error.message, /\(\d{3}\)/);
      }
    });

    it("keeps a 404 unmapped when the pushed file set had no workflow files", async () => {
      const mock = installFetchMock([
        // No scope probe for a workflow-less push (no extra round trip).
        route("GET", "/git/ref/heads/main", 200, { object: { sha: "head1" } }),
        route("GET", "/git/commits/head1", 200, { tree: { sha: "basetree1" } }),
        route("POST", "/git/blobs", 201, { sha: "blob1" }),
        route("POST", "/git/trees", 404, { message: "Not Found" }),
      ]);
      restore = mock.restore;

      const result = await new GitHubRepositoryWriterAdapter().commitFiles(
        link,
        { "src/index.ts": "export {};" },
        "chore: update",
        "ghp_test",
      );

      assert.strictEqual(result.success, false);
      if (!result.success) assert.strictEqual(result.error.code, "unknown");
      assert.ok(
        !mock.calls.some((c) => c.path === "/user"),
        "must not probe scopes for a push without workflow files",
      );
    });
  });
});
