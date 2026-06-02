import { describe, it, beforeEach, afterEach } from "node:test";
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
): MockRoute => ({
  match: (m, p) => m === method && p.includes(pathFragment),
  status,
  body,
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

  it("rejects a config without GitHub settings", async () => {
    const result = await new GitHubExporterAdapter().export(sourceDir, {
      destination: "github",
    });

    assert.strictEqual(result.success, false);
    assert.match(result.error ?? "", /missing GitHub configuration/i);
  });
});
