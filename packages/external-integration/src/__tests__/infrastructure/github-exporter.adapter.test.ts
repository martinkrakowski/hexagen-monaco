import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GitHubExporterAdapter } from "../../infrastructure/adapters/github-exporter.adapter.js";
import type { ExportConfig } from "@hexagen/project-generation";

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
  /** Response headers (e.g. `x-oauth-scopes` for scope-detection tests). */
  headers?: Record<string, string>;
}

/**
 * Minimal `fetch` stand-in driven by an ordered list of routes. Each route is
 * matched in order and consumed once, so the test asserts both the response
 * shape and the call sequence the adapter performs.
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

    // Strict head-of-queue matching: each call must match the *next* expected
    // route, so a regression in the create→blob→tree→commit→ref ordering is
    // caught instead of silently consuming a later route. (The two blob POSTs
    // share an interchangeable matcher, so their relative order is free.)
    const route = remaining[0];
    if (!route || !route.match(method, apiPath)) {
      throw new Error(
        `Unexpected request: ${method} ${apiPath}` +
          (route ? ` (expected to match route at head of queue)` : ""),
      );
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
      // Every expected route must have been consumed; a leftover means the
      // adapter skipped a request we asserted it would make.
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

const githubConfig = (): ExportConfig => ({
  destination: "github",
  github: {
    token: "ghp_test",
    owner: "octocat",
    repoName: "hexagen-app",
    isPrivate: false,
  },
});

describe("GitHubExporterAdapter", () => {
  let sourceDir: string;
  let restore: (() => void) | null = null;

  beforeEach(async () => {
    sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gh-export-"));
    await fs.writeFile(path.join(sourceDir, "README.md"), "# Hello");
    await fs.mkdir(path.join(sourceDir, "src"));
    await fs.writeFile(path.join(sourceDir, "src", "index.ts"), "export {};");
  });

  afterEach(async () => {
    restore?.();
    restore = null;
    await fs.rm(sourceDir, { recursive: true, force: true });
  });

  it("creates a parentless commit + POST ref when pushing to a fresh repo", async () => {
    const mock = installFetchMock([
      route("GET", "/user", 200, { login: "octocat" }),
      route("POST", "/user/repos", 201, { name: "hexagen-app" }),
      route("POST", "/git/blobs", 201, { sha: "blob1" }),
      route("POST", "/git/blobs", 201, { sha: "blob2" }),
      route("POST", "/git/trees", 201, { sha: "tree1" }),
      // Fresh repo has no main ref yet — probed before committing.
      route("GET", "/git/ref/heads/main", 404, { message: "Not Found" }),
      route("POST", "/git/commits", 201, { sha: "commit1" }),
      route("POST", "/git/refs", 201, { ref: "refs/heads/main" }),
    ]);
    restore = mock.restore;

    const result = await new GitHubExporterAdapter().export(
      sourceDir,
      githubConfig(),
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(
      result.destinationUrl,
      "https://github.com/octocat/hexagen-app",
    );
    // Initial commit has no parents.
    const commit = mock.calls.find((c) => c.path.endsWith("/git/commits"));
    assert.ok(commit, "expected a commit to be created");
    assert.ok(
      !("parents" in (commit!.body as Record<string, unknown>)),
      "initial commit should be parentless",
    );
    // The ref is created, never PATCH-updated, on a fresh repo.
    const createRef = mock.calls.find(
      (c) => c.path === "/repos/octocat/hexagen-app/git/refs",
    );
    assert.deepStrictEqual(createRef?.body, {
      ref: "refs/heads/main",
      sha: "commit1",
    });
    assert.ok(
      !mock.calls.some((c) => c.method === "PATCH"),
      "should not PATCH a ref that does not exist",
    );
  });

  it("chains the existing head as parent and fast-forwards (force:false) on an existing branch", async () => {
    const mock = installFetchMock([
      route("GET", "/user", 200, { login: "octocat" }),
      route("POST", "/user/repos", 201, { name: "hexagen-app" }),
      route("POST", "/git/blobs", 201, { sha: "blob1" }),
      route("POST", "/git/blobs", 201, { sha: "blob2" }),
      route("POST", "/git/trees", 201, { sha: "tree1" }),
      // Probe returns the current head before we build the commit.
      route("GET", "/git/ref/heads/main", 200, {
        ref: "refs/heads/main",
        object: { sha: "existing-head" },
      }),
      route("POST", "/git/commits", 201, { sha: "commit2" }),
      route("PATCH", "/git/refs/heads/main", 200, { ref: "refs/heads/main" }),
    ]);
    restore = mock.restore;

    const result = await new GitHubExporterAdapter().export(
      sourceDir,
      githubConfig(),
    );

    assert.strictEqual(result.success, true);
    // Regression: the repo must be created with auto_init:true, otherwise the
    // first createBlob hits `409 Git Repository is empty` on the brand-new repo.
    const createRepo = mock.calls.find((c) => c.path === "/user/repos");
    assert.strictEqual(
      (createRepo!.body as { auto_init?: boolean }).auto_init,
      true,
      "repo must be created with an initial commit (auto_init:true)",
    );
    // Commit chains the prior head so history is preserved.
    const commit = mock.calls.find((c) => c.path.endsWith("/git/commits"));
    assert.deepStrictEqual((commit!.body as { parents?: string[] }).parents, [
      "existing-head",
    ]);
    // Ref update is a non-destructive fast-forward.
    const patch = mock.calls.find((c) => c.method === "PATCH");
    assert.deepStrictEqual(patch?.body, { sha: "commit2", force: false });
  });

  it("pushes non-destructively when the target repo already exists with history", async () => {
    const mock = installFetchMock([
      route("GET", "/user", 200, { login: "octocat" }),
      route("POST", "/user/repos", 422, {
        message: "Repository creation failed.",
        errors: [{ message: "name already exists on this account" }],
      }),
      // Existing repo: its default branch is read before committing.
      route("GET", "/repos/octocat/hexagen-app", 200, {
        default_branch: "main",
      }),
      route("POST", "/git/blobs", 201, { sha: "blob1" }),
      route("POST", "/git/blobs", 201, { sha: "blob2" }),
      route("POST", "/git/trees", 201, { sha: "tree1" }),
      route("GET", "/git/ref/heads/main", 200, {
        ref: "refs/heads/main",
        object: { sha: "prior-head" },
      }),
      route("POST", "/git/commits", 201, { sha: "commit3" }),
      route("PATCH", "/git/refs/heads/main", 200, { ref: "refs/heads/main" }),
    ]);
    restore = mock.restore;

    const result = await new GitHubExporterAdapter().export(
      sourceDir,
      githubConfig(),
    );

    assert.strictEqual(result.success, true);
    const commit = mock.calls.find((c) => c.path.endsWith("/git/commits"));
    assert.deepStrictEqual((commit!.body as { parents?: string[] }).parents, [
      "prior-head",
    ]);
    const patch = mock.calls.find((c) => c.method === "PATCH");
    assert.strictEqual((patch?.body as { force?: boolean }).force, false);
  });

  it("surfaces a conflict (no force) when the branch is created during a race", async () => {
    const mock = installFetchMock([
      route("GET", "/user", 200, { login: "octocat" }),
      route("POST", "/user/repos", 201, { name: "hexagen-app" }),
      route("POST", "/git/blobs", 201, { sha: "blob1" }),
      route("POST", "/git/blobs", 201, { sha: "blob2" }),
      route("POST", "/git/trees", 201, { sha: "tree1" }),
      // Probe sees no ref, so we build a parentless commit...
      route("GET", "/git/ref/heads/main", 404, { message: "Not Found" }),
      route("POST", "/git/commits", 201, { sha: "commit4" }),
      // ...but a concurrent export created the branch before our POST lands.
      route("POST", "/git/refs", 422, { message: "Reference already exists" }),
    ]);
    restore = mock.restore;

    const result = await new GitHubExporterAdapter().export(
      sourceDir,
      githubConfig(),
    );

    // A parentless commit can't fast-forward onto the new history, so we
    // surface a conflict rather than force-overwriting it.
    assert.strictEqual(result.success, false);
    assert.match(result.error ?? "", /concurrently|409/);
    assert.ok(
      !mock.calls.some((c) => c.method === "PATCH"),
      "must not force-PATCH over concurrently-created history",
    );
  });

  it("fails with the API error when the token is unauthorized", async () => {
    const mock = installFetchMock([
      // The owner-resolution probe is the first call and fails on a bad token.
      route("GET", "/user", 401, { message: "Bad credentials" }),
    ]);
    restore = mock.restore;

    const result = await new GitHubExporterAdapter().export(
      sourceDir,
      githubConfig(),
    );

    assert.strictEqual(result.success, false);
    assert.match(result.error ?? "", /401/);
    assert.strictEqual(result.destinationUrl, "");
  });

  it("creates the repo under an organization when owner is not the authenticated user", async () => {
    const mock = installFetchMock([
      route("GET", "/user", 200, { login: "octocat" }),
      route("POST", "/orgs/acme/repos", 201, { name: "hexagen-app" }),
      route("POST", "/git/blobs", 201, { sha: "blob1" }),
      route("POST", "/git/blobs", 201, { sha: "blob2" }),
      route("POST", "/git/trees", 201, { sha: "tree1" }),
      route("GET", "/git/ref/heads/main", 200, {
        ref: "refs/heads/main",
        object: { sha: "org-head" },
      }),
      route("POST", "/git/commits", 201, { sha: "commit-org" }),
      route("PATCH", "/git/refs/heads/main", 200, { ref: "refs/heads/main" }),
    ]);
    restore = mock.restore;

    const result = await new GitHubExporterAdapter().export(sourceDir, {
      destination: "github",
      github: {
        token: "ghp_test",
        owner: "acme",
        repoName: "hexagen-app",
        isPrivate: false,
      },
    });

    assert.strictEqual(result.success, true);
    // Created under the org endpoint, never /user/repos.
    assert.ok(
      mock.calls.some((c) => c.path === "/orgs/acme/repos"),
      "org repo must be created via POST /orgs/{owner}/repos",
    );
    assert.ok(
      !mock.calls.some((c) => c.path === "/user/repos"),
      "must not fall back to /user/repos for an org owner",
    );
    // destinationUrl points at where the repo was actually created.
    assert.strictEqual(
      result.destinationUrl,
      "https://github.com/acme/hexagen-app",
    );
  });

  it("targets the repo's default branch when it is not main", async () => {
    const mock = installFetchMock([
      route("GET", "/user", 200, { login: "octocat" }),
      // GitHub initialized this repo on "trunk" (account default), not "main".
      route("POST", "/user/repos", 201, { default_branch: "trunk" }),
      route("POST", "/git/blobs", 201, { sha: "blob1" }),
      route("POST", "/git/blobs", 201, { sha: "blob2" }),
      route("POST", "/git/trees", 201, { sha: "tree1" }),
      route("GET", "/git/ref/heads/trunk", 200, {
        ref: "refs/heads/trunk",
        object: { sha: "trunk-head" },
      }),
      route("POST", "/git/commits", 201, { sha: "commit-trunk" }),
      route("PATCH", "/git/refs/heads/trunk", 200, { ref: "refs/heads/trunk" }),
    ]);
    restore = mock.restore;

    const result = await new GitHubExporterAdapter().export(
      sourceDir,
      githubConfig(),
    );

    assert.strictEqual(result.success, true);
    // The result reports the real default branch so the export route can
    // persist it on githubLink (editor push targets it).
    assert.strictEqual(result.defaultBranch, "trunk");
    // The scaffold is committed onto the default branch, not an orphan "main".
    assert.ok(
      mock.calls.some((c) => c.path.endsWith("/git/refs/heads/trunk")),
      "must update the default branch (trunk)",
    );
    assert.ok(
      !mock.calls.some((c) => c.path.includes("/heads/main")),
      "must not touch a 'main' ref when the default branch is trunk",
    );
  });

  it("rejects a config without GitHub settings", async () => {
    const result = await new GitHubExporterAdapter().export(sourceDir, {
      destination: "github",
    });

    assert.strictEqual(result.success, false);
    assert.match(result.error ?? "", /missing GitHub configuration/i);
  });

  describe("workflow OAuth-scope handling", () => {
    const WORKFLOW_FILE = ".github/workflows/sync-integrity.yml";

    async function addWorkflowFile() {
      await fs.mkdir(path.join(sourceDir, ".github", "workflows"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(sourceDir, WORKFLOW_FILE),
        "name: sync-integrity\n",
      );
    }

    it("skips workflow files with a warning when scopes are KNOWN to lack 'workflow' (degrade, don't fail)", async () => {
      await addWorkflowFile();
      const mock = installFetchMock([
        // Scope-less token: x-oauth-scopes present but without `workflow`.
        route(
          "GET",
          "/user",
          200,
          { login: "octocat" },
          {
            "x-oauth-scopes": "read:user, user:email, repo",
          },
        ),
        route("POST", "/user/repos", 201, { name: "hexagen-app" }),
        // Only the two non-workflow files reach blob creation.
        route("POST", "/git/blobs", 201, { sha: "blob1" }),
        route("POST", "/git/blobs", 201, { sha: "blob2" }),
        route("POST", "/git/trees", 201, { sha: "tree1" }),
        route("GET", "/git/ref/heads/main", 404, { message: "Not Found" }),
        route("POST", "/git/commits", 201, { sha: "commit1" }),
        route("POST", "/git/refs", 201, { ref: "refs/heads/main" }),
      ]);
      restore = mock.restore;

      const result = await new GitHubExporterAdapter().export(
        sourceDir,
        githubConfig(),
      );

      assert.strictEqual(result.success, true);
      // The submitted tree must not contain the workflow path (GitHub would
      // reject the whole tree with an opaque 404).
      const tree = mock.calls.find((c) => c.path.endsWith("/git/trees"));
      const paths = (tree!.body as { tree: Array<{ path: string }> }).tree.map(
        (e) => e.path,
      );
      assert.ok(
        !paths.includes(WORKFLOW_FILE),
        "workflow file must be skipped",
      );
      assert.strictEqual(paths.length, 2);
      // One per-file warning naming the skipped file.
      assert.strictEqual(result.warnings?.length, 1);
      assert.match(
        result.warnings![0],
        /\.github\/workflows\/sync-integrity\.yml/,
      );
      assert.match(result.warnings![0], /workflow/);
    });

    it("includes workflow files with no warning when the token has the 'workflow' scope", async () => {
      await addWorkflowFile();
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
        route("POST", "/user/repos", 201, { name: "hexagen-app" }),
        route("POST", "/git/blobs", 201, { sha: "blob1" }),
        route("POST", "/git/blobs", 201, { sha: "blob2" }),
        route("POST", "/git/blobs", 201, { sha: "blob3" }),
        route("POST", "/git/trees", 201, { sha: "tree1" }),
        route("GET", "/git/ref/heads/main", 404, { message: "Not Found" }),
        route("POST", "/git/commits", 201, { sha: "commit1" }),
        route("POST", "/git/refs", 201, { ref: "refs/heads/main" }),
      ]);
      restore = mock.restore;

      const result = await new GitHubExporterAdapter().export(
        sourceDir,
        githubConfig(),
      );

      assert.strictEqual(result.success, true);
      const tree = mock.calls.find((c) => c.path.endsWith("/git/trees"));
      const paths = (tree!.body as { tree: Array<{ path: string }> }).tree.map(
        (e) => e.path,
      );
      assert.ok(paths.includes(WORKFLOW_FILE));
      assert.strictEqual(result.warnings, undefined);
    });

    it("fails open (workflow file included) when the scope header is absent", async () => {
      await addWorkflowFile();
      const mock = installFetchMock([
        // No x-oauth-scopes header → scopes unknown → proceed as if scoped.
        route("GET", "/user", 200, { login: "octocat" }),
        route("POST", "/user/repos", 201, { name: "hexagen-app" }),
        route("POST", "/git/blobs", 201, { sha: "blob1" }),
        route("POST", "/git/blobs", 201, { sha: "blob2" }),
        route("POST", "/git/blobs", 201, { sha: "blob3" }),
        route("POST", "/git/trees", 201, { sha: "tree1" }),
        route("GET", "/git/ref/heads/main", 404, { message: "Not Found" }),
        route("POST", "/git/commits", 201, { sha: "commit1" }),
        route("POST", "/git/refs", 201, { ref: "refs/heads/main" }),
      ]);
      restore = mock.restore;

      const result = await new GitHubExporterAdapter().export(
        sourceDir,
        githubConfig(),
      );

      assert.strictEqual(result.success, true);
      const tree = mock.calls.find((c) => c.path.endsWith("/git/trees"));
      const paths = (tree!.body as { tree: Array<{ path: string }> }).tree.map(
        (e) => e.path,
      );
      assert.ok(paths.includes(WORKFLOW_FILE));
    });

    it("surfaces the typed remap when scopes were unknown and createTree 404s over local workflow files", async () => {
      await addWorkflowFile();
      const mock = installFetchMock([
        route("GET", "/user", 200, { login: "octocat" }),
        route("POST", "/user/repos", 201, { name: "hexagen-app" }),
        route("POST", "/git/blobs", 201, { sha: "blob1" }),
        route("POST", "/git/blobs", 201, { sha: "blob2" }),
        route("POST", "/git/blobs", 201, { sha: "blob3" }),
        // GitHub's opaque workflow-scope rejection: bare 404 on the tree POST.
        route("POST", "/git/trees", 404, {
          message: "Not Found",
          documentation_url:
            "https://docs.github.com/rest/git/trees#create-a-tree",
        }),
      ]);
      restore = mock.restore;

      const result = await new GitHubExporterAdapter().export(
        sourceDir,
        githubConfig(),
      );

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.errorCode, "workflow-scope-missing");
      assert.match(result.error ?? "", /workflow/i);
      // The remap text must not carry a parenthesized status code — the export
      // route's /\((401|403)\)/ → reauth_required regex must not misfire.
      assert.doesNotMatch(result.error ?? "", /\(\d{3}\)/);
    });

    it("keeps the raw 404 (no typed code) when the tree had no workflow files", async () => {
      // No workflow file added — only README.md and src/index.ts.
      const mock = installFetchMock([
        route("GET", "/user", 200, { login: "octocat" }),
        route("POST", "/user/repos", 201, { name: "hexagen-app" }),
        route("POST", "/git/blobs", 201, { sha: "blob1" }),
        route("POST", "/git/blobs", 201, { sha: "blob2" }),
        route("POST", "/git/trees", 404, { message: "Not Found" }),
      ]);
      restore = mock.restore;

      const result = await new GitHubExporterAdapter().export(
        sourceDir,
        githubConfig(),
      );

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.errorCode, undefined);
      assert.match(result.error ?? "", /404/);
    });
  });
});
