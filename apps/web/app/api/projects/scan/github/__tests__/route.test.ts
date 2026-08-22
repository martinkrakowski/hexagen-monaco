import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ANON_SESSION_COOKIE } from "../../../../../../lib/anon-session";
import { getQuotaStore, QUOTA_LIMITS } from "../../../../../../lib/quota-store";
import { GITHUB_SCAN_ENV_VAR } from "@/lib/project-scan/clone";

/* ------------------------------------------------------------------ */
/* Doubles                                                             */
/* ------------------------------------------------------------------ */

const cloneRepository = vi.hoisted(() => vi.fn());
const preflightRepository = vi.hoisted(() => vi.fn());
const cleanup = vi.hoisted(() => vi.fn(async () => {}));
const resolveHexagenBin = vi.hoisted(() => vi.fn(() => null as string | null));
const execFileMock = vi.hoisted(() =>
  vi.fn(
    (
      _file: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      callback(null, "", "");
    },
  ),
);

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFile: execFileMock };
});

vi.mock("@/lib/project-scan/clone", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/project-scan/clone")>();
  return {
    ...actual,
    // The bounding itself is unit-tested in clone.test.ts. Here the doubles
    // exist so the route's ORDERING and ERROR SURFACE can be asserted without
    // touching the network or spawning git.
    cloneRepository,
    preflightRepository,
    createCloneWorkspace: async () => ({
      repoDir: "/tmp/hexagen-clone-test/repo",
      homeDir: "/tmp/hexagen-clone-test/home",
      cleanup,
    }),
  };
});

vi.mock("@/lib/project-scan/hexagen-bin", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/project-scan/hexagen-bin")>();
  return { ...actual, resolveHexagenBin };
});

vi.mock("@/lib/monorepo-root", () => ({
  findMonorepoRoot: () => "/repo",
}));

const rateLimitAllowed = vi.hoisted(() => ({ value: true }));
vi.mock("../../../../../../lib/rate-limiter", () => ({
  checkRateLimit: () =>
    rateLimitAllowed.value
      ? { allowed: true }
      : { allowed: false, retryAfter: 30_000 },
}));

import { GET, POST } from "../route";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const ORIGIN = "http://localhost";

function postJson(
  body: unknown,
  options: { sid?: string; origin?: string } = {},
): Promise<Response> {
  const headers = new Headers({ "content-type": "application/json" });
  // `Host` as well as `Origin`. The same-origin guard builds the request's own
  // effective origin from the Host header, and `new NextRequest(url)` does NOT
  // synthesize one -- so sending Origin alone leaves the guard with nothing to
  // compare against and every request 403s before it reaches the code under
  // test. Setting both is also the shape a real browser request has.
  headers.set("host", new URL(ORIGIN).host);
  headers.set("origin", options.origin ?? ORIGIN);
  if (options.sid) {
    headers.set("cookie", `${ANON_SESSION_COOKIE}=${options.sid}`);
  }
  const request = new NextRequest(`${ORIGIN}/api/projects/scan/github`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return POST(request);
}

async function frames(response: Response): Promise<Record<string, unknown>[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const VALID_BODY = {
  name: "checkout-service",
  repoUrl: "acme/checkout-service",
  ref: "main",
};

let sidCounter = 0;
function freshSid(): string {
  // MUST be UUID-shaped. `resolveAnonSession` validates the cookie against an
  // anchored UUID regex and mints a fresh session for anything else -- so a
  // readable sid like `github-scan-test-1` is silently replaced, the route
  // charges the minted session, and a test peeking at the original sees an
  // untouched counter. That reads as "the route never charges" when the route
  // is fine.
  sidCounter += 1;
  const tail = sidCounter.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${tail}`;
}

beforeEach(() => {
  process.env[GITHUB_SCAN_ENV_VAR] = "1";
  rateLimitAllowed.value = true;
  cloneRepository.mockReset();
  preflightRepository.mockReset();
  cleanup.mockClear();
  resolveHexagenBin.mockReset();
  resolveHexagenBin.mockReturnValue(null);
  execFileMock.mockClear();
  preflightRepository.mockResolvedValue({
    ok: true,
    sizeBytes: 1024,
    defaultBranch: "main",
  });
  cloneRepository.mockResolvedValue({ ok: true, durationMs: 12 });
});

afterEach(() => {
  delete process.env[GITHUB_SCAN_ENV_VAR];
});

/* ------------------------------------------------------------------ */
/* Kill switch (bounding requirement 9)                                */
/* ------------------------------------------------------------------ */

describe("BROWNFIELD_GITHUB_SCAN kill switch", () => {
  it("404s and does nothing when the flag is unset", async () => {
    delete process.env[GITHUB_SCAN_ENV_VAR];
    const response = await postJson(VALID_BODY, { sid: freshSid() });
    assert.equal(response.status, 404);
    assert.equal(preflightRepository.mock.calls.length, 0);
    assert.equal(cloneRepository.mock.calls.length, 0);
  });

  it("404s for a misspelled or falsy flag value", async () => {
    for (const value of ["", "0", "no", "enabled", "yes", "tru"]) {
      process.env[GITHUB_SCAN_ENV_VAR] = value;
      const response = await postJson(VALID_BODY, { sid: freshSid() });
      assert.equal(response.status, 404, `expected 404 for ${value}`);
    }
    assert.equal(cloneRepository.mock.calls.length, 0);
  });

  it("hides the endpoint from GET probes too", async () => {
    delete process.env[GITHUB_SCAN_ENV_VAR];
    assert.equal((await GET()).status, 404);
    process.env[GITHUB_SCAN_ENV_VAR] = "1";
    assert.equal((await GET()).status, 405);
  });

  it("is read at call time, not snapshotted at module load", async () => {
    // The module was imported with the flag unset at file scope; flipping it
    // in beforeEach must be enough to enable the route.
    const response = await postJson(VALID_BODY, { sid: freshSid() });
    assert.notEqual(response.status, 404);
  });
});

/* ------------------------------------------------------------------ */
/* Gate ordering                                                       */
/* ------------------------------------------------------------------ */

describe("gate ordering", () => {
  it("rejects a cross-origin request before any outbound call", async () => {
    const response = await postJson(VALID_BODY, {
      sid: freshSid(),
      origin: "https://evil.tld",
    });
    assert.equal(response.status, 403);
    assert.equal(preflightRepository.mock.calls.length, 0);
  });

  it("rate-limits before any outbound call", async () => {
    rateLimitAllowed.value = false;
    const response = await postJson(VALID_BODY, { sid: freshSid() });
    assert.equal(response.status, 429);
    assert.equal(preflightRepository.mock.calls.length, 0);
  });
});

/* ------------------------------------------------------------------ */
/* Reference validation (requirements 1 and 2)                         */
/* ------------------------------------------------------------------ */

describe("repository reference validation", () => {
  const hostile = [
    "https://evil.tld/acme/checkout",
    "https://evilgithub.com/acme/checkout",
    "https://github.com.evil.tld/acme/checkout",
    "https://user:pass@github.com/acme/checkout",
    "ssh://git@github.com/acme/checkout.git",
    "file:///etc/passwd",
    "git@github.com:acme/checkout.git",
    "--upload-pack=id/repo",
    "https://github.com/-evil/repo",
    "acme/../../etc",
  ];

  for (const repoUrl of hostile) {
    it(`refuses ${repoUrl} without any network call`, async () => {
      const response = await postJson(
        { ...VALID_BODY, repoUrl },
        { sid: freshSid() },
      );
      assert.equal(response.status, 400);
      const [frame] = await frames(response);
      assert.equal(frame.type, "error");
      assert.equal(frame.code, "clone_failed");
      assert.equal(preflightRepository.mock.calls.length, 0);
      assert.equal(cloneRepository.mock.calls.length, 0);
    });
  }

  it("refuses a hostile ref", async () => {
    const response = await postJson(
      { ...VALID_BODY, ref: "--upload-pack=id" },
      { sid: freshSid() },
    );
    assert.equal(response.status, 400);
    assert.equal(preflightRepository.mock.calls.length, 0);
  });

  it("requires a project name", async () => {
    const response = await postJson(
      { repoUrl: "acme/checkout" },
      { sid: freshSid() },
    );
    assert.equal(response.status, 400);
    const [frame] = await frames(response);
    assert.equal(frame.reason, "invalid-name");
  });

  it("passes only the PARSED reference downstream", async () => {
    await postJson(
      { ...VALID_BODY, repoUrl: "https://github.com/acme/checkout.git" },
      { sid: freshSid() },
    );
    assert.equal(preflightRepository.mock.calls.length, 1);
    assert.deepEqual(preflightRepository.mock.calls[0][0], {
      owner: "acme",
      repo: "checkout",
      ref: "main",
    });
  });
});

/* ------------------------------------------------------------------ */
/* Preflight -> quota ordering (requirements 3 and 10)                 */
/* ------------------------------------------------------------------ */

describe("preflight and quota", () => {
  it("emits repo_too_large without cloning when the preflight refuses", async () => {
    preflightRepository.mockResolvedValue({
      ok: false,
      code: "repo_too_large",
      detail: "preflight size 900000000 > 134217728",
    });
    const response = await postJson(VALID_BODY, { sid: freshSid() });
    assert.equal(response.status, 413);
    const [frame] = await frames(response);
    assert.equal(frame.code, "repo_too_large");
    assert.equal(cloneRepository.mock.calls.length, 0);
  });

  it("does not burn a scan credit on a preflight refusal", async () => {
    const sid = freshSid();
    preflightRepository.mockResolvedValue({
      ok: false,
      code: "repo_too_large",
      detail: "too big",
    });
    await postJson(VALID_BODY, { sid });
    const store = getQuotaStore();
    assert.equal(store.peek(sid, "scan").remaining, QUOTA_LIMITS.scan);
  });

  it("charges exactly one scan for a run that reaches the clone", async () => {
    const sid = freshSid();
    const store = getQuotaStore();
    const before = store.peek(sid, "scan").remaining;
    const response = await postJson(VALID_BODY, { sid });
    await response.text();
    assert.equal(store.peek(sid, "scan").remaining, before - 1);
  });

  it("emits quota_exhausted once the daily budget is spent", async () => {
    const sid = freshSid();
    const store = getQuotaStore();
    for (let index = 0; index < QUOTA_LIMITS.scan; index += 1) {
      store.consume(sid, "scan");
    }
    const response = await postJson(VALID_BODY, { sid });
    assert.equal(response.status, 429);
    const [frame] = await frames(response);
    assert.equal(frame.code, "quota_exhausted");
    // The gate's own copy is reused, not rewritten by the route.
    assert.ok(String(frame.message).length > 0);
    assert.equal(preflightRepository.mock.calls.length, 0);
  });
});

/* ------------------------------------------------------------------ */
/* Streaming surface                                                   */
/* ------------------------------------------------------------------ */

describe("NDJSON stream", () => {
  it("streams clone progress with git's real byte counts only", async () => {
    cloneRepository.mockImplementation(
      async (input: {
        onProgress?: (progress: {
          line: string;
          receivedBytes: number | null;
        }) => void;
      }) => {
        input.onProgress?.({
          line: "remote: Enumerating objects: 2481, done.",
          receivedBytes: null,
        });
        input.onProgress?.({
          line: "Receiving objects: 100% (2481/2481), 18.40 MiB",
          receivedBytes: 19_293_798,
        });
        return { ok: true, durationMs: 1900 };
      },
    );

    const response = await postJson(VALID_BODY, { sid: freshSid() });
    const parsed = await frames(response);
    const chunks = parsed.filter((frame) => frame.type === "chunk");
    assert.equal(chunks.length, 2);
    // No byte figure -> the field is ABSENT. It is never zero-filled or
    // derived from a percentage.
    assert.equal("receivedBytes" in chunks[0], false);
    assert.equal(chunks[1].receivedBytes, 19_293_798);
    // Every frame carries the correlation id (F-36).
    assert.ok(parsed.every((frame) => typeof frame.runId === "string"));
    const runIds = new Set(parsed.map((frame) => frame.runId));
    assert.equal(runIds.size, 1);
  });

  it("makes a failed clone terminal: an error frame and no artifacts", async () => {
    cloneRepository.mockResolvedValue({
      ok: false,
      code: "clone_failed",
      detail: "git exited 128 for /tmp/hexagen-clone-abc/repo",
    });

    const response = await postJson(VALID_BODY, { sid: freshSid() });
    // Headers are already sent, so the stream carries the failure, not a status.
    assert.equal(response.status, 200);
    const parsed = await frames(response);
    const last = parsed[parsed.length - 1];
    assert.equal(last.type, "error");
    assert.equal(last.code, "clone_failed");
    assert.equal(
      parsed.some((frame) => frame.type === "done"),
      false,
    );
    assert.equal(
      parsed.some((frame) => frame.stage === 1),
      false,
      "the scan stage must never start after a failed clone",
    );
  });

  it("never leaks a path, a URL or git's stderr into the client payload", async () => {
    cloneRepository.mockResolvedValue({
      ok: false,
      code: "clone_failed",
      detail:
        "fatal: unable to access 'https://github.com/acme/x.git': " +
        "/tmp/hexagen-clone-abc/repo; internal.host",
    });
    const response = await postJson(VALID_BODY, { sid: freshSid() });
    const body = JSON.stringify(await frames(response));
    for (const secret of [
      "/tmp/",
      "hexagen-clone",
      "internal.host",
      "fatal:",
      "detail",
    ]) {
      assert.equal(
        body.includes(secret),
        false,
        `client payload must not contain ${secret}`,
      );
    }
  });

  it("surfaces a timeout with the timeout code, not a generic failure", async () => {
    cloneRepository.mockResolvedValue({
      ok: false,
      code: "timeout",
      detail: "clone exceeded 60000ms",
    });
    const response = await postJson(VALID_BODY, { sid: freshSid() });
    const parsed = await frames(response);
    assert.equal(parsed[parsed.length - 1].code, "timeout");
  });

  it("emits scan_could_not_run when the hexagen binary is absent", async () => {
    resolveHexagenBin.mockReturnValue(null);
    const response = await postJson(VALID_BODY, { sid: freshSid() });
    const parsed = await frames(response);
    const last = parsed[parsed.length - 1];
    assert.equal(last.type, "error");
    assert.equal(last.code, "scan_could_not_run");
    // The clone stage DID complete, so its stage-complete is honest.
    assert.ok(
      parsed.some(
        (frame) => frame.type === "stage-complete" && frame.stage === 0,
      ),
    );
  });

  it("only ever emits codes from the F-35 set", async () => {
    const allowed = new Set([
      "clone_failed",
      "repo_too_large",
      "quota_exhausted",
      "scan_could_not_run",
      "timeout",
    ]);
    for (const code of ["clone_failed", "repo_too_large", "timeout"]) {
      cloneRepository.mockResolvedValue({ ok: false, code, detail: "x" });
      const response = await postJson(VALID_BODY, { sid: freshSid() });
      for (const frame of await frames(response)) {
        if (frame.type !== "error") continue;
        assert.ok(
          allowed.has(String(frame.code)),
          `unexpected code ${String(frame.code)}`,
        );
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* Cleanup (requirement 6)                                             */
/* ------------------------------------------------------------------ */

describe("workspace cleanup", () => {
  it("removes the workspace after a successful run", async () => {
    const response = await postJson(VALID_BODY, { sid: freshSid() });
    await response.text();
    assert.equal(cleanup.mock.calls.length, 1);
  });

  it("removes the workspace after a failed clone", async () => {
    cloneRepository.mockResolvedValue({
      ok: false,
      code: "clone_failed",
      detail: "x",
    });
    const response = await postJson(VALID_BODY, { sid: freshSid() });
    await response.text();
    assert.equal(cleanup.mock.calls.length, 1);
  });

  it("removes the workspace after an unexpected throw", async () => {
    cloneRepository.mockRejectedValue(new Error("boom"));
    const response = await postJson(VALID_BODY, { sid: freshSid() });
    const parsed = await frames(response);
    assert.equal(parsed[parsed.length - 1].code, "scan_could_not_run");
    assert.equal(cleanup.mock.calls.length, 1);
  });

  it("removes the workspace when the consumer cancels mid-stream", async () => {
    cloneRepository.mockImplementation(
      async (input: { signal?: AbortSignal }) => {
        await new Promise((resolve) => {
          if (input.signal?.aborted) {
            resolve(null);
            return;
          }
          input.signal?.addEventListener("abort", () => resolve(null), {
            once: true,
          });
        });
        return { ok: false, code: "clone_failed", detail: "aborted" };
      },
    );

    const response = await postJson(VALID_BODY, { sid: freshSid() });
    const reader = response.body?.getReader();
    if (!reader) throw new Error("expected a streaming body");
    await reader.cancel();
    // Give the stream's cancel() -> abort -> finally chain a turn to run.
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(cleanup.mock.calls.length, 1);
  });
});
