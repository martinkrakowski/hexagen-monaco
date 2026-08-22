import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import { GitHubPullRequestAdapter } from "../../infrastructure/adapters/github-pull-request.adapter.js";
import {
  isPullRequestWriteEnabled,
  PULL_REQUEST_WRITES_ENV_VAR,
} from "../../application/ports/out/pull-request-opener.port.js";
import type { OpenPullRequestRequest } from "../../application/ports/out/pull-request-opener.port.js";
import { InMemoryPullRequestOpener } from "../doubles/in-memory-pull-request-opener.double.js";

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
  /** When set, the mock throws this instead of answering (transport failure). */
  throws?: unknown;
}

/**
 * Ordered, consume-once `fetch` stand-in — same shape as the sibling exporter
 * and repository-writer suites, so an ordering regression (authorize BEFORE
 * write) is caught rather than swallowed.
 *
 * `restore()` asserts every queued route was consumed. For a security adapter
 * that is the load-bearing assertion in half these tests: "the call sequence
 * stopped where it was supposed to stop" is exactly the property under test.
 */
function installFetchMock(routes: MockRoute[]): {
  calls: RecordedCall[];
  restore: (options?: { allowUnused?: boolean }) => void;
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
    if (route.throws !== undefined) throw route.throws;
    const status = route.status;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(route.headers ?? {}),
      json: async () => route.body,
    } as Response;
  }) as typeof fetch;

  return {
    calls,
    restore: (options) => {
      globalThis.fetch = original;
      if (!options?.allowUnused) {
        assert.equal(
          remaining.length,
          0,
          `Unused mocked routes remain: ${remaining.length}`,
        );
      }
    },
  };
}

/** A fetch that fails the test if anything calls it. */
function installForbiddenFetch(): {
  callCount: () => number;
  restore: () => void;
} {
  const original = globalThis.fetch;
  let count = 0;
  globalThis.fetch = (async (url: string) => {
    count += 1;
    throw new Error(`Network must not be reached, but got: ${url}`);
  }) as typeof fetch;
  return {
    callCount: () => count,
    restore: () => (globalThis.fetch = original),
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

const exactRoute = (
  method: string,
  path: string,
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): MockRoute => ({
  match: (m, p) => m === method && p === path,
  status,
  body,
  headers,
});

const OWNER = "octocat";
const REPO = "legacy-app";
const REPO_PATH = `/repos/${OWNER}/${REPO}`;

/** `GET /user` answering as OWNER with a fully-scoped token. */
const viewerRoute = (scopes = "repo, workflow") =>
  exactRoute(
    "GET",
    "/user",
    200,
    { login: OWNER },
    {
      "x-oauth-scopes": scopes,
    },
  );

const repoRoute = (
  overrides: Record<string, unknown> = {},
  status = 200,
): MockRoute =>
  exactRoute("GET", REPO_PATH, status, {
    owner: { login: OWNER },
    name: REPO,
    default_branch: "main",
    permissions: { push: true },
    archived: false,
    disabled: false,
    ...overrides,
  });

/** The six calls that push a branch, after authorization has passed. */
const pushRoutes = (defaultBranch = "main"): MockRoute[] => [
  route("GET", `/git/ref/heads/${defaultBranch}`, 200, {
    object: { sha: "base1" },
  }),
  route("GET", "/git/commits/base1", 200, { tree: { sha: "basetree1" } }),
  route("POST", "/git/blobs", 201, { sha: "blob1" }),
  route("POST", "/git/trees", 201, { sha: "tree1" }),
  route("POST", "/git/commits", 201, { sha: "commit1" }),
  route("POST", "/git/refs", 201, { ref: "refs/heads/hexagen/x" }),
];

const prRoute = (status = 201, body?: unknown): MockRoute =>
  route(
    "POST",
    "/pulls",
    status,
    body ?? {
      number: 42,
      html_url: `https://github.com/${OWNER}/${REPO}/pull/42`,
      title: "Add the Hexagen conformance gate",
      created_at: "2026-08-20T10:00:00Z",
    },
  );

const baseRequest = (
  overrides: Partial<OpenPullRequestRequest> = {},
): OpenPullRequestRequest => ({
  repository: { owner: OWNER, repo: REPO },
  title: "Add the Hexagen conformance gate",
  body: "Installs the architectural conformance gate.",
  commitMessage: "ci: add the Hexagen conformance gate",
  files: [
    {
      path: ".github/workflows/sync-integrity.yml",
      content: "name: Architectural Integrity\n",
    },
  ],
  ...overrides,
});

/** Adapter with the kill switch ARMED and a pinned branch suffix. */
const armedAdapter = () =>
  new GitHubPullRequestAdapter({
    env: { [PULL_REQUEST_WRITES_ENV_VAR]: "true" },
    generateBranchSuffix: () => "abcd1234",
  });

describe("isPullRequestWriteEnabled (kill switch, default OFF)", () => {
  it("is off when the variable is absent — the default-off contract", () => {
    assert.equal(isPullRequestWriteEnabled({}), false);
  });

  const offValues = [
    "",
    " ",
    "0",
    "false",
    "FALSE",
    "no",
    "off",
    "yes",
    "on",
    "enabled",
    "tru",
    "true1",
    "2",
  ];
  for (const value of offValues) {
    it(`is off for ${JSON.stringify(value)}`, () => {
      assert.equal(
        isPullRequestWriteEnabled({ [PULL_REQUEST_WRITES_ENV_VAR]: value }),
        false,
      );
    });
  }

  const onValues = ["1", "true", "TRUE", " true ", "True"];
  for (const value of onValues) {
    it(`is on for ${JSON.stringify(value)}`, () => {
      assert.equal(
        isPullRequestWriteEnabled({ [PULL_REQUEST_WRITES_ENV_VAR]: value }),
        true,
      );
    });
  }

  it("ignores a lookalike variable name", () => {
    assert.equal(
      isPullRequestWriteEnabled({ HEXAGEN_ENABLE_PR_WRITE: "true" }),
      false,
    );
  });
});

describe("GitHubPullRequestAdapter — the switch gates everything", () => {
  let restore: (() => void) | null = null;

  afterEach(() => {
    restore?.();
    restore = null;
  });

  it("refuses with `disabled` and makes ZERO network calls when the variable is absent", async () => {
    const guard = installForbiddenFetch();
    restore = guard.restore;

    const result = await new GitHubPullRequestAdapter({
      env: {},
    }).openPullRequest(baseRequest(), "ghp_valid");

    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.error.code, "disabled");
    assert.equal(guard.callCount(), 0);
  });

  it("stays disabled for an explicitly falsey value", async () => {
    const guard = installForbiddenFetch();
    restore = guard.restore;

    const result = await new GitHubPullRequestAdapter({
      env: { [PULL_REQUEST_WRITES_ENV_VAR]: "false" },
    }).openPullRequest(baseRequest(), "ghp_valid");

    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.error.code, "disabled");
    assert.equal(guard.callCount(), 0);
  });

  it("reads the switch at CALL time, not construction time", async () => {
    const guard = installForbiddenFetch();
    restore = guard.restore;

    // A live env object: armed when the adapter is constructed, disarmed
    // before the call. An implementation that snapshotted the value in the
    // constructor would proceed here.
    const env: Record<string, string | undefined> = {
      [PULL_REQUEST_WRITES_ENV_VAR]: "true",
    };
    const adapter = new GitHubPullRequestAdapter({ env });
    delete env[PULL_REQUEST_WRITES_ENV_VAR];

    const result = await adapter.openPullRequest(baseRequest(), "ghp_valid");

    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.error.code, "disabled");
    assert.equal(guard.callCount(), 0);
  });

  it("rejects a blank token before touching the network", async () => {
    const guard = installForbiddenFetch();
    restore = guard.restore;

    const result = await armedAdapter().openPullRequest(baseRequest(), "   ");

    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.error.code, "auth-failed");
    assert.equal(guard.callCount(), 0);
  });
});

describe("GitHubPullRequestAdapter — happy path", () => {
  let restore: ((options?: { allowUnused?: boolean }) => void) | null = null;

  afterEach(() => {
    restore?.();
    restore = null;
  });

  it("authorizes, pushes objects before any ref, then opens the pull request", async () => {
    const mock = installFetchMock([
      viewerRoute(),
      repoRoute(),
      ...pushRoutes(),
      prRoute(),
    ]);
    restore = mock.restore;

    const result = await armedAdapter().openPullRequest(
      baseRequest(),
      "ghp_valid",
    );

    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.value.prNumber, 42);
      assert.equal(
        result.value.prUrl,
        `https://github.com/${OWNER}/${REPO}/pull/42`,
      );
      assert.equal(result.value.baseBranch, "main");
      assert.equal(
        result.value.headBranch,
        "hexagen/conformance-gate-abcd1234",
      );
      assert.equal(
        result.value.createdAt.toISOString(),
        "2026-08-20T10:00:00.000Z",
      );
    }

    // Authorization strictly precedes the first write.
    const paths = mock.calls.map((c) => `${c.method} ${c.path}`);
    const firstWrite = paths.findIndex((p) => p.startsWith("POST"));
    assert.equal(paths[0], "GET /user");
    assert.equal(paths[1], `GET ${REPO_PATH}`);
    assert.ok(firstWrite > 1, "no POST may precede the authorization reads");

    // The ref is CREATED, never updated: no PATCH anywhere in the sequence.
    assert.equal(
      mock.calls.filter((c) => c.method === "PATCH").length,
      0,
      "the adapter must never PATCH a ref",
    );

    // The ref that gets created lives in the reserved namespace.
    const refCall = mock.calls.find((c) => c.path.endsWith("/git/refs"))!;
    assert.equal(
      (refCall.body as { ref: string }).ref,
      "refs/heads/hexagen/conformance-gate-abcd1234",
    );

    // The pull request targets the host-reported default branch.
    const prCall = mock.calls.find((c) => c.path.endsWith("/pulls"))!;
    assert.deepEqual(prCall.body, {
      title: "Add the Hexagen conformance gate",
      body: "Installs the architectural conformance gate.",
      head: "hexagen/conformance-gate-abcd1234",
      base: "main",
    });
  });

  it("bases the pull request on the repo's real default branch, not a hardcoded 'main'", async () => {
    const mock = installFetchMock([
      viewerRoute(),
      repoRoute({ default_branch: "trunk" }),
      ...pushRoutes("trunk"),
      prRoute(),
    ]);
    restore = mock.restore;

    const result = await armedAdapter().openPullRequest(
      baseRequest(),
      "ghp_valid",
    );

    assert.equal(result.success, true);
    const prCall = mock.calls.find((c) => c.path.endsWith("/pulls"))!;
    assert.equal((prCall.body as { base: string }).base, "trunk");
  });

  it("matches the owner login case-insensitively", async () => {
    const mock = installFetchMock([
      exactRoute("GET", "/user", 200, { login: "OctoCat" }, {}),
      repoRoute({ owner: { login: "octocat" } }),
      ...pushRoutes(),
      prRoute(),
    ]);
    restore = mock.restore;

    const result = await armedAdapter().openPullRequest(
      baseRequest(),
      "ghp_valid",
    );
    assert.equal(result.success, true);
  });

  it("falls back to the title when no commit message is supplied", async () => {
    const mock = installFetchMock([
      viewerRoute(),
      repoRoute(),
      ...pushRoutes(),
      prRoute(),
    ]);
    restore = mock.restore;

    await armedAdapter().openPullRequest(
      baseRequest({ commitMessage: "   " }),
      "ghp_valid",
    );

    const commitCall = mock.calls.find(
      (c) => c.method === "POST" && c.path.endsWith("/git/commits"),
    )!;
    assert.equal(
      (commitCall.body as { message: string }).message,
      "Add the Hexagen conformance gate",
    );
  });
});

describe("GitHubPullRequestAdapter — authorization (D-U3: self-owned only)", () => {
  let restore: ((options?: { allowUnused?: boolean }) => void) | null = null;

  afterEach(() => {
    restore?.();
    restore = null;
  });

  it("refuses a repository owned by someone else, having written nothing", async () => {
    const mock = installFetchMock([
      viewerRoute(),
      repoRoute({ owner: { login: "acme-corp" } }),
    ]);
    restore = mock.restore;

    const result = await armedAdapter().openPullRequest(
      baseRequest(),
      "ghp_valid",
    );

    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.error.code, "not-self-owned");
      assert.match(result.error.message, /acme-corp/);
    }
    // Exactly two reads, zero writes.
    assert.equal(mock.calls.length, 2);
    assert.equal(mock.calls.filter((c) => c.method !== "GET").length, 0);
  });

  it("refuses an org repository the token could otherwise push to", async () => {
    const mock = installFetchMock([
      viewerRoute(),
      repoRoute({
        owner: { login: "hexagen-org" },
        permissions: { push: true },
      }),
    ]);
    restore = mock.restore;

    const result = await armedAdapter().openPullRequest(
      baseRequest(),
      "ghp_valid",
    );

    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.error.code, "not-self-owned");
  });

  it("treats an absent `permissions` bag as no-push, not as assume-push", async () => {
    const mock = installFetchMock([
      viewerRoute(),
      repoRoute({ permissions: undefined }),
    ]);
    restore = mock.restore;

    const result = await armedAdapter().openPullRequest(
      baseRequest(),
      "ghp_valid",
    );

    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.error.code, "insufficient-permission");
    }
    assert.equal(mock.calls.filter((c) => c.method !== "GET").length, 0);
  });

  it("refuses an archived repository", async () => {
    const mock = installFetchMock([
      viewerRoute(),
      repoRoute({ archived: true }),
    ]);
    restore = mock.restore;

    const result = await armedAdapter().openPullRequest(
      baseRequest(),
      "ghp_valid",
    );
    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.error.code, "repo-unavailable");
  });

  it("refuses a disabled repository", async () => {
    const mock = installFetchMock([
      viewerRoute(),
      repoRoute({ disabled: true }),
    ]);
    restore = mock.restore;

    const result = await armedAdapter().openPullRequest(
      baseRequest(),
      "ghp_valid",
    );
    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.error.code, "repo-unavailable");
  });

  it("fails closed when GitHub does not report an owner", async () => {
    const mock = installFetchMock([viewerRoute(), repoRoute({ owner: {} })]);
    restore = mock.restore;

    const result = await armedAdapter().openPullRequest(
      baseRequest(),
      "ghp_valid",
    );
    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.error.code, "unknown");
  });

  it("maps an expired token on GET /user to auth-failed, with no repo read", async () => {
    const mock = installFetchMock([
      exactRoute("GET", "/user", 401, { message: "Bad credentials" }),
    ]);
    restore = mock.restore;

    const result = await armedAdapter().openPullRequest(
      baseRequest(),
      "ghp_expired",
    );

    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.error.code, "auth-failed");
      assert.equal(result.error.detail, "Bad credentials");
    }
    assert.equal(mock.calls.length, 1);
  });

  it("refuses when GitHub redirected the lookup to a renamed repository", async () => {
    // `fetch` follows GitHub's 301 after a rename/transfer, so the record we
    // authorized would not be the one the writes address. Identity must match
    // exactly what was requested.
    const mock = installFetchMock([
      viewerRoute(),
      repoRoute({ name: "renamed-app" }),
    ]);
    restore = mock.restore;

    const result = await armedAdapter().openPullRequest(
      baseRequest(),
      "ghp_valid",
    );

    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.error.code, "repo-unavailable");
      assert.match(result.error.message, /renamed or transferred/);
    }
    assert.equal(mock.calls.filter((c) => c.method !== "GET").length, 0);
  });

  it("refuses when GitHub redirected the lookup to another owner's repository", async () => {
    const mock = installFetchMock([
      viewerRoute(),
      repoRoute({ owner: { login: "acme-corp" }, name: REPO }),
    ]);
    restore = mock.restore;

    const result = await armedAdapter().openPullRequest(
      baseRequest(),
      "ghp_valid",
    );

    assert.equal(result.success, false);
    // The identity mismatch is caught before the ownership comparison, and
    // either way nothing is written.
    if (!result.success) {
      assert.ok(
        result.error.code === "repo-unavailable" ||
          result.error.code === "not-self-owned",
      );
    }
    assert.equal(mock.calls.filter((c) => c.method !== "GET").length, 0);
  });

  it("fails closed when GitHub does not report a repository name", async () => {
    const mock = installFetchMock([viewerRoute(), repoRoute({ name: 42 })]);
    restore = mock.restore;

    const result = await armedAdapter().openPullRequest(
      baseRequest(),
      "ghp_valid",
    );
    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.error.code, "unknown");
  });

  it("maps a deleted repository (404) to repo-unavailable", async () => {
    const mock = installFetchMock([viewerRoute(), repoRoute({}, 404)]);
    restore = mock.restore;

    const result = await armedAdapter().openPullRequest(
      baseRequest(),
      "ghp_valid",
    );
    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.error.code, "repo-unavailable");
  });
});

describe("GitHubPullRequestAdapter — input handling", () => {
  let restore: (() => void) | null = null;

  afterEach(() => {
    restore?.();
    restore = null;
  });

  const rejectedBeforeNetwork = async (
    request: OpenPullRequestRequest,
  ): Promise<string> => {
    const guard = installForbiddenFetch();
    restore = guard.restore;
    const result = await armedAdapter().openPullRequest(request, "ghp_valid");
    assert.equal(result.success, false, "expected the request to be rejected");
    assert.equal(
      guard.callCount(),
      0,
      "rejection must precede any network call",
    );
    return result.success ? "" : result.error.code;
  };

  const badPaths: Array<[string, string]> = [
    ["traversal", "../../../etc/passwd"],
    ["interior traversal", "docs/../../secrets.env"],
    ["absolute", "/etc/passwd"],
    ["git metadata", ".git/config"],
    ["case-shifted git metadata", ".GIT/config"],
    ["mixed-case git metadata", ".Git/hooks/pre-commit"],
    ["NTFS short-name git metadata", "git~1/config"],
    ["backslash", "..\\..\\windows\\system32"],
    ["empty", ""],
    ["directory", "docs/"],
    ["double slash", "docs//x.md"],
    ["dot segment", "./x.md"],
  ];
  for (const [label, badPath] of badPaths) {
    it(`rejects a ${label} file path before any network call`, async () => {
      const code = await rejectedBeforeNetwork(
        baseRequest({ files: [{ path: badPath, content: "x" }] }),
      );
      assert.equal(code, "invalid-input");
    });
  }

  it("rejects a NUL byte in a file path", async () => {
    const code = await rejectedBeforeNetwork(
      baseRequest({ files: [{ path: "docs/x\u0000.md", content: "x" }] }),
    );
    assert.equal(code, "invalid-input");
  });

  const badOwners = [
    "octocat/../..",
    "octo cat",
    "",
    "-octocat",
    "a".repeat(40),
  ];
  for (const owner of badOwners) {
    it(`rejects the owner ${JSON.stringify(owner)}`, async () => {
      const code = await rejectedBeforeNetwork(
        baseRequest({ repository: { owner, repo: REPO } }),
      );
      assert.equal(code, "invalid-input");
    });
  }

  const badRepos = ["../other-repo", "repo/../..", "", ".", "..", "re po"];
  for (const repo of badRepos) {
    it(`rejects the repo name ${JSON.stringify(repo)}`, async () => {
      const code = await rejectedBeforeNetwork(
        baseRequest({ repository: { owner: OWNER, repo } }),
      );
      assert.equal(code, "invalid-input");
    });
  }

  it("rejects an empty file set", async () => {
    const code = await rejectedBeforeNetwork(baseRequest({ files: [] }));
    assert.equal(code, "invalid-input");
  });

  it("rejects duplicate paths", async () => {
    const code = await rejectedBeforeNetwork(
      baseRequest({
        files: [
          { path: "a.md", content: "1" },
          { path: "a.md", content: "2" },
        ],
      }),
    );
    assert.equal(code, "invalid-input");
  });

  it("rejects more files than the cap allows", async () => {
    const code = await rejectedBeforeNetwork(
      baseRequest({
        files: Array.from({ length: 51 }, (_unused, i) => ({
          path: `docs/f${i}.md`,
          content: "x",
        })),
      }),
    );
    assert.equal(code, "invalid-input");
  });

  it("rejects a single oversized file", async () => {
    const code = await rejectedBeforeNetwork(
      baseRequest({
        files: [{ path: "big.bin", content: "x".repeat(512 * 1024 + 1) }],
      }),
    );
    assert.equal(code, "invalid-input");
  });

  it("rejects a set that exceeds the total-size cap", async () => {
    const code = await rejectedBeforeNetwork(
      baseRequest({
        files: Array.from({ length: 5 }, (_unused, i) => ({
          path: `docs/f${i}.md`,
          content: "x".repeat(512 * 1024),
        })),
      }),
    );
    assert.equal(code, "invalid-input");
  });

  it("rejects a blank title", async () => {
    const code = await rejectedBeforeNetwork(baseRequest({ title: "  " }));
    assert.equal(code, "invalid-input");
  });

  it("rejects an over-long title", async () => {
    const code = await rejectedBeforeNetwork(
      baseRequest({ title: "t".repeat(257) }),
    );
    assert.equal(code, "invalid-input");
  });

  it("rejects an over-long body", async () => {
    const code = await rejectedBeforeNetwork(
      baseRequest({ body: "b".repeat(60_001) }),
    );
    assert.equal(code, "invalid-input");
  });

  it("rejects non-string file content", async () => {
    const code = await rejectedBeforeNetwork(
      baseRequest({
        files: [{ path: "a.md", content: 42 as unknown as string }],
      }),
    );
    assert.equal(code, "invalid-input");
  });
});

describe("GitHubPullRequestAdapter — the caller cannot choose a ref", () => {
  let restore: ((options?: { allowUnused?: boolean }) => void) | null = null;

  afterEach(() => {
    restore?.();
    restore = null;
  });

  const hostileSlugs = [
    "main",
    "../main",
    "../../refs/heads/main",
    "refs/heads/main",
    "HEAD",
    "  ",
    "!!!",
    "a".repeat(200),
  ];

  for (const slug of hostileSlugs) {
    it(`confines the branch derived from slug ${JSON.stringify(slug)} to the hexagen/ namespace`, async () => {
      const mock = installFetchMock([
        viewerRoute(),
        repoRoute(),
        ...pushRoutes(),
        prRoute(),
      ]);
      restore = mock.restore;

      const result = await armedAdapter().openPullRequest(
        baseRequest({ branchSlug: slug }),
        "ghp_valid",
      );

      assert.equal(result.success, true);
      const refCall = mock.calls.find((c) => c.path.endsWith("/git/refs"))!;
      const ref = (refCall.body as { ref: string }).ref;
      assert.match(ref, /^refs\/heads\/hexagen\/[a-z0-9][a-z0-9-]*$/);
      assert.notEqual(ref, "refs/heads/main");
      assert.ok(!ref.includes(".."), "no traversal survives the sanitizer");
      assert.ok(
        ref.endsWith("-abcd1234"),
        "the random suffix is always appended",
      );
    });
  }

  it("never sends a `base` or `head` the caller supplied under any extra key", async () => {
    const mock = installFetchMock([
      viewerRoute(),
      repoRoute(),
      ...pushRoutes(),
      prRoute(),
    ]);
    restore = mock.restore;

    const smuggled = {
      ...baseRequest(),
      base: "refs/heads/production",
      head: "refs/heads/production",
      headBranch: "production",
      baseBranch: "production",
    } as unknown as OpenPullRequestRequest;

    const result = await armedAdapter().openPullRequest(smuggled, "ghp_valid");

    assert.equal(result.success, true);
    const prCall = mock.calls.find((c) => c.path.endsWith("/pulls"))!;
    assert.equal((prCall.body as { base: string }).base, "main");
    assert.equal(
      (prCall.body as { head: string }).head,
      "hexagen/conformance-gate-abcd1234",
    );
  });
});

describe("GitHubPullRequestAdapter — workflow scope", () => {
  let restore: ((options?: { allowUnused?: boolean }) => void) | null = null;

  afterEach(() => {
    restore?.();
    restore = null;
  });

  it("refuses BEFORE any write when the token is known to lack `workflow`", async () => {
    const mock = installFetchMock([viewerRoute("repo")]);
    restore = mock.restore;

    const result = await armedAdapter().openPullRequest(
      baseRequest(),
      "ghp_valid",
    );

    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.error.code, "workflow-scope-missing");
      assert.match(
        result.error.message,
        /\.github\/workflows\/sync-integrity\.yml/,
      );
    }
    // Only the identity read happened — not even the repository was fetched.
    assert.equal(mock.calls.length, 1);
  });

  it("fails open when the scope header is absent, because createTree backstops it", async () => {
    const mock = installFetchMock([
      exactRoute("GET", "/user", 200, { login: OWNER }, {}),
      repoRoute(),
      ...pushRoutes(),
      prRoute(),
    ]);
    restore = mock.restore;

    const result = await armedAdapter().openPullRequest(
      baseRequest(),
      "ghp_valid",
    );
    assert.equal(result.success, true);
  });

  it("does not require `workflow` when the file set has no workflow files", async () => {
    const mock = installFetchMock([
      viewerRoute("repo"),
      repoRoute(),
      ...pushRoutes(),
      prRoute(),
    ]);
    restore = mock.restore;

    const result = await armedAdapter().openPullRequest(
      baseRequest({
        files: [{ path: "HEXAGEN-GATE-INSTALL.md", content: "#" }],
      }),
      "ghp_valid",
    );
    assert.equal(result.success, true);
  });

  it("surfaces the reactive createTree remap as workflow-scope-missing", async () => {
    const mock = installFetchMock([
      exactRoute("GET", "/user", 200, { login: OWNER }, {}),
      repoRoute(),
      route("GET", "/git/ref/heads/main", 200, { object: { sha: "base1" } }),
      route("GET", "/git/commits/base1", 200, { tree: { sha: "basetree1" } }),
      route("POST", "/git/blobs", 201, { sha: "blob1" }),
      route("POST", "/git/trees", 404, { message: "Not Found" }),
    ]);
    restore = mock.restore;

    const result = await armedAdapter().openPullRequest(
      baseRequest(),
      "ghp_valid",
    );

    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.error.code, "workflow-scope-missing");
    }
  });
});

describe("GitHubPullRequestAdapter — failure modes", () => {
  let restore: ((options?: { allowUnused?: boolean }) => void) | null = null;

  afterEach(() => {
    restore?.();
    restore = null;
  });

  it("refuses an empty repository (no commit to branch from)", async () => {
    const mock = installFetchMock([
      viewerRoute(),
      repoRoute(),
      route("GET", "/git/ref/heads/main", 404, { message: "Not Found" }),
    ]);
    restore = mock.restore;

    const result = await armedAdapter().openPullRequest(
      baseRequest(),
      "ghp_valid",
    );

    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.error.code, "repo-unavailable");
      assert.match(result.error.message, /no commit/i);
    }
  });

  it("refuses rather than proposing a tree that deletes the repository", async () => {
    // No `base_tree` means the new tree contains ONLY our files, so the commit
    // would show every other file as deleted. That must never become a pull
    // request, so an unreadable base tree stops before the first blob.
    const mock = installFetchMock([
      viewerRoute(),
      repoRoute(),
      route("GET", "/git/ref/heads/main", 200, { object: { sha: "base1" } }),
      route("GET", "/git/commits/base1", 200, { message: "no tree here" }),
    ]);
    restore = mock.restore;

    const result = await armedAdapter().openPullRequest(
      baseRequest(),
      "ghp_valid",
    );

    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.error.code, "repo-unavailable");
      assert.match(result.error.message, /Nothing was written\./);
    }
    assert.equal(
      mock.calls.filter((c) => c.method === "POST").length,
      0,
      "not even a blob may be created once the base tree is unreadable",
    );
  });

  it("still promises 'nothing was written' for a failure before the ref call", async () => {
    const mock = installFetchMock([
      viewerRoute(),
      repoRoute(),
      route("GET", "/git/ref/heads/main", 200, { object: { sha: "base1" } }),
      route("GET", "/git/commits/base1", 200, { tree: { sha: "basetree1" } }),
      route("POST", "/git/blobs", 201, { sha: "blob1" }),
      route("POST", "/git/trees", 201, { sha: "tree1" }),
      route("POST", "/git/commits", 500, { message: "Server Error" }),
    ]);
    restore = mock.restore;

    const result = await armedAdapter().openPullRequest(
      baseRequest(),
      "ghp_valid",
    );

    assert.equal(result.success, false);
    if (!result.success) {
      assert.match(result.error.message, /Nothing was written\./);
    }
  });

  it("stops claiming 'nothing was written' once the ref call has been issued", async () => {
    // A transport failure ON the create-ref call cannot distinguish "GitHub
    // never saw it" from "GitHub created it and the response was lost".
    const mock = installFetchMock([
      viewerRoute(),
      repoRoute(),
      route("GET", "/git/ref/heads/main", 200, { object: { sha: "base1" } }),
      route("GET", "/git/commits/base1", 200, { tree: { sha: "basetree1" } }),
      route("POST", "/git/blobs", 201, { sha: "blob1" }),
      route("POST", "/git/trees", 201, { sha: "tree1" }),
      route("POST", "/git/commits", 201, { sha: "commit1" }),
      {
        match: (m, p) => m === "POST" && p.includes("/git/refs"),
        status: 0,
        body: null,
        throws: new TypeError("fetch failed"),
      },
    ]);
    restore = mock.restore;

    const result = await armedAdapter().openPullRequest(
      baseRequest(),
      "ghp_valid",
    );

    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.error.code, "network");
      assert.ok(
        !result.error.message.includes("Nothing was written."),
        "must not promise an untrue outcome",
      );
      assert.match(result.error.message, /may or may not have been created/);
      assert.match(
        result.error.message,
        /Nothing on the default branch changed/,
      );
    }
  });

  it("maps a concurrently-created branch to `conflict` without overwriting it", async () => {
    const mock = installFetchMock([
      viewerRoute(),
      repoRoute(),
      route("GET", "/git/ref/heads/main", 200, { object: { sha: "base1" } }),
      route("GET", "/git/commits/base1", 200, { tree: { sha: "basetree1" } }),
      route("POST", "/git/blobs", 201, { sha: "blob1" }),
      route("POST", "/git/trees", 201, { sha: "tree1" }),
      route("POST", "/git/commits", 201, { sha: "commit1" }),
      route("POST", "/git/refs", 422, { message: "Reference already exists" }),
    ]);
    restore = mock.restore;

    const result = await armedAdapter().openPullRequest(
      baseRequest(),
      "ghp_valid",
    );

    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.error.code, "conflict");
    // No retry, no PATCH: the adapter gives up rather than moving a ref.
    assert.equal(mock.calls.filter((c) => c.method === "PATCH").length, 0);
  });

  it("reports the partial state when the branch lands but POST /pulls fails", async () => {
    const mock = installFetchMock([
      viewerRoute(),
      repoRoute(),
      ...pushRoutes(),
      prRoute(422, {
        message: "Validation Failed",
        documentation_url: "https://docs.github.com/rest/pulls",
        errors: [{ resource: "PullRequest", message: "No commits between" }],
      }),
    ]);
    restore = mock.restore;

    const result = await armedAdapter().openPullRequest(
      baseRequest(),
      "ghp_valid",
    );

    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.error.code, "branch-written-no-pr");
      assert.equal(result.error.branchRef, "hexagen/conformance-gate-abcd1234");
      assert.equal(
        result.error.compareUrl,
        `https://github.com/${OWNER}/${REPO}/compare/main...hexagen/conformance-gate-abcd1234?expand=1`,
      );
      // GitHub's own short reason survives; the rest of its body does not.
      assert.equal(result.error.detail, "Validation Failed");
      assert.ok(
        !JSON.stringify(result.error).includes("documentation_url"),
        "the raw GitHub body must not be forwarded",
      );
      assert.ok(
        !JSON.stringify(result.error).includes("No commits between"),
        "per-field error arrays must not be forwarded",
      );
    }
  });

  it("maps 429 to rate-limit", async () => {
    const mock = installFetchMock([
      viewerRoute(),
      repoRoute(),
      route("GET", "/git/ref/heads/main", 429, {
        message: "API rate limit exceeded",
      }),
    ]);
    restore = mock.restore;

    const result = await armedAdapter().openPullRequest(
      baseRequest(),
      "ghp_valid",
    );
    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.error.code, "rate-limit");
  });

  it("maps a 403 secondary rate limit to rate-limit, not auth-failed", async () => {
    const mock = installFetchMock([
      exactRoute("GET", "/user", 403, {
        message: "You have exceeded a secondary rate limit",
      }),
    ]);
    restore = mock.restore;

    const result = await armedAdapter().openPullRequest(
      baseRequest(),
      "ghp_valid",
    );
    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.error.code, "rate-limit");
  });

  it("maps a plain 403 to auth-failed", async () => {
    const mock = installFetchMock([
      exactRoute("GET", "/user", 403, { message: "Resource not accessible" }),
    ]);
    restore = mock.restore;

    const result = await armedAdapter().openPullRequest(
      baseRequest(),
      "ghp_valid",
    );
    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.error.code, "auth-failed");
  });

  it("maps a transport failure to network", async () => {
    const mock = installFetchMock([
      {
        match: (m, p) => m === "GET" && p === "/user",
        status: 0,
        body: null,
        throws: new TypeError("fetch failed"),
      },
    ]);
    restore = mock.restore;

    const result = await armedAdapter().openPullRequest(
      baseRequest(),
      "ghp_valid",
    );
    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.error.code, "network");
  });

  it("never leaks the token into a returned error", async () => {
    const mock = installFetchMock([
      exactRoute("GET", "/user", 500, { message: "Server Error" }),
    ]);
    restore = mock.restore;

    const result = await armedAdapter().openPullRequest(
      baseRequest(),
      "ghp_supersecrettoken",
    );

    assert.equal(result.success, false);
    if (!result.success) {
      assert.ok(!JSON.stringify(result.error).includes("ghp_supersecrettoken"));
      assert.equal(result.error.code, "unknown");
    }
  });

  it("does not fail a pull request GitHub already opened over a bad timestamp", async () => {
    const mock = installFetchMock([
      viewerRoute(),
      repoRoute(),
      ...pushRoutes(),
      prRoute(201, {
        number: 7,
        html_url: `https://github.com/${OWNER}/${REPO}/pull/7`,
        title: "t",
        created_at: "not-a-date",
      }),
    ]);
    restore = mock.restore;

    const result = await armedAdapter().openPullRequest(
      baseRequest(),
      "ghp_valid",
    );
    assert.equal(result.success, true);
    if (result.success) {
      assert.ok(!Number.isNaN(result.value.createdAt.getTime()));
    }
  });

  it("treats an unreadable POST /pulls response as branch-written-no-pr", async () => {
    const mock = installFetchMock([
      viewerRoute(),
      repoRoute(),
      ...pushRoutes(),
      prRoute(201, { unexpected: true }),
    ]);
    restore = mock.restore;

    const result = await armedAdapter().openPullRequest(
      baseRequest(),
      "ghp_valid",
    );
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.error.code, "branch-written-no-pr");
      assert.equal(result.error.branchRef, "hexagen/conformance-gate-abcd1234");
    }
  });
});

describe("InMemoryPullRequestOpener (double parity)", () => {
  it("records a defensive copy of the request", async () => {
    const double = new InMemoryPullRequestOpener();
    const files = [{ path: "a.md", content: "1" }];
    const request = baseRequest({ files });

    const result = await double.openPullRequest(request);

    files[0] = { path: "b.md", content: "2" };
    assert.equal(result.success, true);
    assert.equal(double.requests.length, 1);
    assert.equal(double.requests[0]!.files[0]!.path, "a.md");
  });

  it("can be told to fail", async () => {
    const double = new InMemoryPullRequestOpener();
    double.failWith = { code: "disabled", message: "off" };

    const result = await double.openPullRequest(baseRequest());

    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.error.code, "disabled");
  });
});
