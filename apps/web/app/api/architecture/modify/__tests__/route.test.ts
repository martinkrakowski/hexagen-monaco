import { describe, it, vi, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Mock the composition root and logger; the route logic (path anchoring +
// intent → use-case delegation) runs for real.
vi.mock("@/lib/wire.server", async () => {
  // Re-export the REAL error class so the route's `instanceof` narrowing (400
  // path-traversal vs 500 missing-anchor) matches instances thrown in tests.
  const { MonorepoRootNotFoundError } = await vi.importActual<
    typeof import("@/lib/monorepo-root")
  >("@/lib/monorepo-root");
  return {
    getModifyArchitectureUseCase: vi.fn(),
    findMonorepoRoot: vi.fn(),
    MonorepoRootNotFoundError,
  };
});
vi.mock("@/lib/wire.shared", () => ({
  createWebLogger: () => ({ info: vi.fn(), errorWithException: vi.fn() }),
}));

import { POST } from "../route";
import {
  getModifyArchitectureUseCase,
  findMonorepoRoot,
  MonorepoRootNotFoundError,
} from "@/lib/wire.server";

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/architecture/modify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/architecture/modify", () => {
  const execute = vi.fn();

  beforeEach(() => {
    execute.mockReset();

    vi.mocked(findMonorepoRoot).mockReturnValue("/fake/repo");
    // Simulate prod cwd ≠ monorepo root.
    vi.spyOn(process, "cwd").mockReturnValue("/fake/repo/apps/web");

    execute.mockResolvedValue({
      success: true,
      value: {
        pipelineRunId: "run-1",
        patchesApplied: 0,
        lintPassed: true,
        transactionId: "tx-1",
        patches: [],
        steps: [],
      },
    });
    vi.mocked(getModifyArchitectureUseCase).mockReturnValue({
      execute,
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes the use case a manifest path anchored at the monorepo root, not process.cwd()", async () => {
    await POST(post({ intent: "add a context" }));

    assert.equal(execute.mock.calls.length, 1);
    // execute(intent, manifestPath, lineage)
    assert.equal(
      execute.mock.calls[0][1],
      "/fake/repo/.architecture/manifest.yaml",
    );
  });

  it("returns 500 (not 400) when the monorepo-root/manifest anchor is missing", async () => {
    // A missing on-disk anchor is a server packaging/config failure; mapping it
    // to 400 would hide it from 5xx monitoring and blame the caller.
    vi.mocked(findMonorepoRoot).mockImplementation(() => {
      throw new MonorepoRootNotFoundError(
        "Could not locate monorepo root from /x. No .architecture/manifest.yaml found.",
      );
    });

    const res = await POST(post({ intent: "add a context" }));

    assert.equal(res.status, 500);
    // Client-safe body: the stable message, NOT the detailed anchor error whose
    // text embeds the server's `from`/process.cwd() filesystem path. Returning
    // err.message here (the pre-fix behavior) disclosed the server layout to
    // cross-origin callers under this route's active wildcard CORS (CWE-209).
    const body = await res.json();
    assert.equal(body.error, "Monorepo root not found");
    assert.doesNotMatch(body.error, /Could not locate|manifest\.yaml|\/x/);
    assert.equal(execute.mock.calls.length, 0);
  });

  it("rejects a cross-origin POST with 403 before reaching the use case", async () => {
    // The mutation gate (D1) must short-circuit a forged cross-origin request
    // whose Origin host differs from the received Host — no manifest work runs.
    const crossOrigin = new NextRequest(
      "http://localhost/api/architecture/modify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          origin: "http://evil.example",
          host: "localhost",
        },
        body: JSON.stringify({ intent: "add a context" }),
      },
    );

    const res = await POST(crossOrigin);

    assert.equal(res.status, 403);
    assert.equal(execute.mock.calls.length, 0);
  });
});
