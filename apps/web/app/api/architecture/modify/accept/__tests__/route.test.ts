import { describe, it, vi, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Mock the composition root and logger; the route logic (path anchoring,
// lint → restore → rollback flow) runs for real.
vi.mock("@/lib/wire.server", async () => {
  // Re-export the REAL MonorepoRootNotFoundError (not a stand-in) so the 500-vs-400
  // tests exercise the genuine production error type — its real prototype and
  // .name. Route and test both import it from this one mocked module, so identity
  // already lines up; using the real class keeps the assertion faithful to prod
  // rather than merely internally consistent with a look-alike.
  const { MonorepoRootNotFoundError } = await vi.importActual<
    typeof import("@/lib/monorepo-root")
  >("@/lib/monorepo-root");
  return {
    getTransactionManager: vi.fn(),
    getManifestMutation: vi.fn(),
    getLintValidation: vi.fn(),
    findMonorepoRoot: vi.fn(),
    MonorepoRootNotFoundError,
  };
});
vi.mock("@/lib/wire.shared", () => ({
  createWebLogger: () => ({ info: vi.fn(), errorWithException: vi.fn() }),
}));

import { POST } from "../route";
import {
  getTransactionManager,
  getManifestMutation,
  getLintValidation,
  findMonorepoRoot,
  MonorepoRootNotFoundError,
} from "@/lib/wire.server";

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/architecture/modify/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/architecture/modify/accept", () => {
  const rollback = vi.fn();
  const commit = vi.fn();
  const applyPatches = vi.fn();
  const restoreFromGit = vi.fn();

  beforeEach(() => {
    rollback.mockReset();
    commit.mockReset();
    applyPatches.mockReset();
    restoreFromGit.mockReset();

    vi.mocked(findMonorepoRoot).mockReturnValue("/fake/repo");
    // Simulate prod cwd ≠ monorepo root.
    vi.spyOn(process, "cwd").mockReturnValue("/fake/repo/apps/web");

    vi.mocked(getTransactionManager).mockReturnValue({
      get: () => ({ status: "speculative", metadata: { patches: [] } }),
      rollback,
      commit,
    } as never);

    applyPatches.mockResolvedValue({ success: true, value: undefined });
    vi.mocked(getManifestMutation).mockReturnValue({
      applyPatches,
      restoreFromGit,
    } as never);

    // Lint FAILS → drives the restore branch.
    vi.mocked(getLintValidation).mockReturnValue({
      validateManifest: vi.fn().mockResolvedValue({
        success: true,
        value: { valid: false, errors: ["boom"] },
      }),
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("restores the manifest against the monorepo-root anchor, not process.cwd()", async () => {
    restoreFromGit.mockResolvedValue({ success: true, value: undefined });

    await POST(post({ transactionId: "tx-1" }));

    assert.equal(restoreFromGit.mock.calls.length, 1);
    assert.equal(
      restoreFromGit.mock.calls[0][0],
      "/fake/repo/.architecture/manifest.yaml",
    );
  });

  it("rolls the transaction back even when git restore fails (never stuck speculative)", async () => {
    restoreFromGit.mockResolvedValue({
      success: false,
      error: new Error("git checkout failed"),
    });

    const res = await POST(post({ transactionId: "tx-1" }));

    assert.equal(rollback.mock.calls.length, 1);
    assert.equal(rollback.mock.calls[0][0], "tx-1");
    assert.equal(res.status, 500);
  });

  it("returns 500 (not 400) when the monorepo-root/manifest anchor is missing", async () => {
    // A missing on-disk anchor is a server packaging/config failure; mapping it
    // to 400 would hide it from 5xx monitoring and blame the caller.
    vi.mocked(findMonorepoRoot).mockImplementation(() => {
      throw new MonorepoRootNotFoundError(
        "Could not locate monorepo root from /x. No .architecture/manifest.yaml found.",
      );
    });

    const res = await POST(post({ transactionId: "tx-1" }));

    assert.equal(res.status, 500);
    // The rethrow lands in the outer catch, which is ALSO a 500 catch-all — so a
    // bare status check can't tell the intended MonorepoRootNotFoundError rethrow
    // from an incidental failure that happens to reach the same handler. Pin the
    // branch: the body must carry the anchor error's message, and no mutation work
    // may have run (we short-circuited at path validation, before applyPatches).
    const body = await res.json();
    assert.match(body.error, /No \.architecture\/manifest\.yaml found/);
    assert.equal(applyPatches.mock.calls.length, 0);
    assert.equal(restoreFromGit.mock.calls.length, 0);
    assert.equal(commit.mock.calls.length, 0);
  });

  it("still returns 400 for a path-traversal manifestPath (client input error)", async () => {
    const res = await POST(
      post({ transactionId: "tx-1", manifestPath: "../../etc/passwd" }),
    );

    assert.equal(res.status, 400);
  });
});
