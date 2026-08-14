import { describe, it, vi, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Mock the composition root and logger; the route logic (path anchoring,
// restore → rollback flow) runs for real.
vi.mock("@/lib/wire.server", () => ({
  getTransactionManager: vi.fn(),
  getManifestMutation: vi.fn(),
  findMonorepoRoot: vi.fn(),
}));
vi.mock("@/lib/wire.shared", () => ({
  createWebLogger: () => ({ info: vi.fn(), errorWithException: vi.fn() }),
}));

import { POST } from "../route";
import {
  getTransactionManager,
  getManifestMutation,
  findMonorepoRoot,
} from "@/lib/wire.server";

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/architecture/modify/reject", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/architecture/modify/reject", () => {
  const rollback = vi.fn();
  const commit = vi.fn();
  const restoreFromGit = vi.fn();

  beforeEach(() => {
    rollback.mockReset();
    commit.mockReset();
    restoreFromGit.mockReset();

    vi.mocked(findMonorepoRoot).mockReturnValue("/fake/repo");
    // Simulate prod cwd ≠ monorepo root.
    vi.spyOn(process, "cwd").mockReturnValue("/fake/repo/apps/web");

    vi.mocked(getTransactionManager).mockReturnValue({
      get: () => ({ status: "speculative", metadata: { patches: [] } }),
      rollback,
      commit,
    } as never);

    vi.mocked(getManifestMutation).mockReturnValue({
      restoreFromGit,
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("restores against the monorepo-root anchor", async () => {
    restoreFromGit.mockResolvedValue({ success: true, value: undefined });

    await POST(post({ transactionId: "tx-1", reason: "nope" }));

    assert.equal(restoreFromGit.mock.calls.length, 1);
    assert.equal(
      restoreFromGit.mock.calls[0][0],
      "/fake/repo/.architecture/manifest.yaml",
    );
  });

  it("reaches transactionManager.rollback even when git restore fails", async () => {
    restoreFromGit.mockResolvedValue({
      success: false,
      error: new Error("git boom"),
    });

    const res = await POST(post({ transactionId: "tx-1", reason: "nope" }));

    assert.equal(rollback.mock.calls.length, 1);
    assert.equal(rollback.mock.calls[0][0], "tx-1");
    assert.equal(res.status, 500);
  });
});
