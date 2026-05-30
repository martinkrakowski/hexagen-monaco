import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GitHubExporterAdapter } from "../../src/infrastructure/adapters/github-exporter.adapter.js";
import type { ExportConfig } from "../../src/application/ports/out/project-exporter.port.js";

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

  return { calls, restore: () => void (globalThis.fetch = original) };
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

  it("creates the branch ref (POST) when pushing to a fresh repo", async () => {
    const mock = installFetchMock([
      route("POST", "/user/repos", 201, { name: "hexagen-app" }),
      route("POST", "/git/blobs", 201, { sha: "blob1" }),
      route("POST", "/git/blobs", 201, { sha: "blob2" }),
      route("POST", "/git/trees", 201, { sha: "tree1" }),
      route("POST", "/git/commits", 201, { sha: "commit1" }),
      // Fresh repo has no main ref yet.
      route("GET", "/git/ref/heads/main", 404, { message: "Not Found" }),
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
    // The ref is created, never PATCH-updated, on a fresh repo.
    const createRef = mock.calls.find(
      (c) => c.path === "/repos/octocat/hexagen-app/git/refs",
    );
    assert.ok(createRef, "expected POST /git/refs to create the branch");
    assert.strictEqual(createRef?.method, "POST");
    assert.deepStrictEqual(createRef?.body, {
      ref: "refs/heads/main",
      sha: "commit1",
    });
    assert.ok(
      !mock.calls.some((c) => c.method === "PATCH"),
      "should not PATCH a ref that does not exist",
    );
  });

  it("updates the branch ref (PATCH) when main already exists", async () => {
    const mock = installFetchMock([
      route("POST", "/user/repos", 201, { name: "hexagen-app" }),
      route("POST", "/git/blobs", 201, { sha: "blob1" }),
      route("POST", "/git/blobs", 201, { sha: "blob2" }),
      route("POST", "/git/trees", 201, { sha: "tree1" }),
      route("POST", "/git/commits", 201, { sha: "commit2" }),
      route("GET", "/git/ref/heads/main", 200, {
        ref: "refs/heads/main",
        object: { sha: "old" },
      }),
      route("PATCH", "/git/refs/heads/main", 200, { ref: "refs/heads/main" }),
    ]);
    restore = mock.restore;

    const result = await new GitHubExporterAdapter().export(
      sourceDir,
      githubConfig(),
    );

    assert.strictEqual(result.success, true);
    const patch = mock.calls.find((c) => c.method === "PATCH");
    assert.ok(patch, "expected PATCH to update existing ref");
    assert.deepStrictEqual(patch?.body, { sha: "commit2", force: true });
  });

  it("continues when the repo already exists", async () => {
    const mock = installFetchMock([
      route("POST", "/user/repos", 422, {
        message: "Repository creation failed.",
        errors: [{ message: "name already exists on this account" }],
      }),
      route("POST", "/git/blobs", 201, { sha: "blob1" }),
      route("POST", "/git/blobs", 201, { sha: "blob2" }),
      route("POST", "/git/trees", 201, { sha: "tree1" }),
      route("POST", "/git/commits", 201, { sha: "commit3" }),
      route("GET", "/git/ref/heads/main", 404, { message: "Not Found" }),
      route("POST", "/git/refs", 201, { ref: "refs/heads/main" }),
    ]);
    restore = mock.restore;

    const result = await new GitHubExporterAdapter().export(
      sourceDir,
      githubConfig(),
    );

    assert.strictEqual(result.success, true);
  });

  it("falls back to PATCH when the ref is created during a race (POST → 422)", async () => {
    const mock = installFetchMock([
      route("POST", "/user/repos", 201, { name: "hexagen-app" }),
      route("POST", "/git/blobs", 201, { sha: "blob1" }),
      route("POST", "/git/blobs", 201, { sha: "blob2" }),
      route("POST", "/git/trees", 201, { sha: "tree1" }),
      route("POST", "/git/commits", 201, { sha: "commit4" }),
      // Probe sees no ref...
      route("GET", "/git/ref/heads/main", 404, { message: "Not Found" }),
      // ...but a concurrent export created it before our POST lands.
      route("POST", "/git/refs", 422, {
        message: "Reference already exists",
      }),
      // Fallback: update the now-existing ref instead of failing.
      route("PATCH", "/git/refs/heads/main", 200, { ref: "refs/heads/main" }),
    ]);
    restore = mock.restore;

    const result = await new GitHubExporterAdapter().export(
      sourceDir,
      githubConfig(),
    );

    assert.strictEqual(result.success, true);
    const patch = mock.calls.find((c) => c.method === "PATCH");
    assert.ok(patch, "expected PATCH fallback after 422 on ref create");
    assert.deepStrictEqual(patch?.body, { sha: "commit4", force: true });
  });

  it("fails with the API error when the token is unauthorized", async () => {
    const mock = installFetchMock([
      route("POST", "/user/repos", 401, { message: "Bad credentials" }),
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

  it("rejects a config without GitHub settings", async () => {
    const result = await new GitHubExporterAdapter().export(sourceDir, {
      destination: "github",
    });

    assert.strictEqual(result.success, false);
    assert.match(result.error ?? "", /missing GitHub configuration/i);
  });
});
