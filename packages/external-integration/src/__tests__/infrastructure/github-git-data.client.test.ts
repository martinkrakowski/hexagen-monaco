import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import {
  GitHubApiError,
  GitHubGitDataClient,
  isWorkflowFilePath,
  parseOAuthScopesHeader,
} from "../../infrastructure/adapters/github-git-data.client.js";

let restoreFetch: (() => void) | null = null;

/** Single-response fetch stand-in with header control (scope-probe tests). */
function installFetchOnce(response: {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}): { calls: Array<{ method: string; url: string }> } {
  const calls: Array<{ method: string; url: string }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url });
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      headers: new Headers(response.headers ?? {}),
      json: async () => response.body ?? {},
    } as Response;
  }) as typeof fetch;
  restoreFetch = () => {
    globalThis.fetch = original;
  };
  return { calls };
}

afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
});

describe("parseOAuthScopesHeader", () => {
  it("parses a comma+space separated scope list", () => {
    const scopes = parseOAuthScopesHeader("read:user, user:email, repo");
    assert.deepEqual(scopes, new Set(["read:user", "user:email", "repo"]));
  });

  it("returns null (unknown) when the header is absent", () => {
    assert.equal(parseOAuthScopesHeader(null), null);
    assert.equal(parseOAuthScopesHeader(undefined), null);
  });

  it("treats an empty header as a KNOWN empty scope set, not unknown", () => {
    const scopes = parseOAuthScopesHeader("");
    assert.notEqual(scopes, null);
    assert.equal(scopes!.size, 0);
  });

  it("parses defensively without the canonical space after the comma", () => {
    const scopes = parseOAuthScopesHeader("repo,workflow");
    assert.deepEqual(scopes, new Set(["repo", "workflow"]));
  });
});

describe("GitHubGitDataClient.getTokenScopes", () => {
  it("returns the scope set when x-oauth-scopes is present", async () => {
    installFetchOnce({
      status: 200,
      headers: { "x-oauth-scopes": "read:user, user:email, repo, workflow" },
    });
    const scopes = await new GitHubGitDataClient().getTokenScopes("ghp_test");
    assert.ok(scopes?.has("workflow"));
    assert.ok(scopes?.has("repo"));
  });

  it("returns a set lacking 'workflow' for a default-scoped app token", async () => {
    installFetchOnce({
      status: 200,
      headers: { "x-oauth-scopes": "read:user, user:email, repo" },
    });
    const scopes = await new GitHubGitDataClient().getTokenScopes("ghp_test");
    assert.notEqual(scopes, null);
    assert.equal(scopes!.has("workflow"), false);
  });

  it("returns null (unknown → callers fail open) when the header is absent", async () => {
    installFetchOnce({ status: 200 });
    const scopes = await new GitHubGitDataClient().getTokenScopes("ghp_test");
    assert.equal(scopes, null);
  });

  it("returns null (unknown) when the probe itself fails", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    restoreFetch = () => {
      globalThis.fetch = original;
    };
    const scopes = await new GitHubGitDataClient().getTokenScopes("ghp_test");
    assert.equal(scopes, null);
  });
});

describe("GitHubGitDataClient.createTree workflow-scope remap", () => {
  const notFound = {
    message: "Not Found",
    documentation_url: "https://docs.github.com/rest/git/trees#create-a-tree",
  };
  const entry = (path: string) => ({
    path,
    mode: "100644",
    type: "blob",
    sha: "abc123",
  });

  it("remaps a 404 to workflow-scope-missing when WE submitted workflow files", async () => {
    installFetchOnce({ status: 404, body: notFound });
    const err = await new GitHubGitDataClient()
      .createTree("ghp_test", "octocat", "repo", [
        entry("README.md"),
        entry(".github/workflows/sync-integrity.yml"),
      ])
      .then(
        () => null,
        (e: unknown) => e,
      );
    assert.ok(err instanceof GitHubApiError);
    assert.equal(err.code, "workflow-scope-missing");
    assert.equal(err.status, 404);
    assert.match(err.message, /workflow/i);
    // The remapped text must never trip the export route's
    // /\((401|403)\)/ → reauth_required regex.
    assert.doesNotMatch(err.message, /\(\d{3}\)/);
  });

  it("passes a 404 through untouched when the local tree had no workflow files", async () => {
    installFetchOnce({ status: 404, body: notFound });
    const err = await new GitHubGitDataClient()
      .createTree("ghp_test", "octocat", "repo", [entry("README.md")])
      .then(
        () => null,
        (e: unknown) => e,
      );
    assert.ok(err instanceof GitHubApiError);
    assert.equal(err.code, undefined);
    assert.match(err.message, /GitHub API error \(404\)/);
  });

  it("does not remap non-404 failures even with workflow files in the tree", async () => {
    installFetchOnce({ status: 422, body: { message: "Validation failed" } });
    const err = await new GitHubGitDataClient()
      .createTree("ghp_test", "octocat", "repo", [
        entry(".github/workflows/ci.yml"),
      ])
      .then(
        () => null,
        (e: unknown) => e,
      );
    assert.ok(err instanceof GitHubApiError);
    assert.equal(err.code, undefined);
    assert.equal(err.status, 422);
  });
});

describe("isWorkflowFilePath", () => {
  it("matches only files under .github/workflows/", () => {
    assert.equal(isWorkflowFilePath(".github/workflows/ci.yml"), true);
    assert.equal(isWorkflowFilePath(".github/workflows/deep/x.yml"), true);
    assert.equal(isWorkflowFilePath(".github/dependabot.yml"), false);
    assert.equal(isWorkflowFilePath("src/workflows/ci.yml"), false);
    assert.equal(isWorkflowFilePath("README.md"), false);
  });
});
