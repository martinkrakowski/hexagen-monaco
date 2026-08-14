import { describe, it, vi, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Mock the composition root and logger; the route logic (path anchoring +
// intent → use-case delegation) runs for real.
vi.mock("@/lib/wire.server", () => ({
  getModifyArchitectureUseCase: vi.fn(),
  findMonorepoRoot: vi.fn(),
}));
vi.mock("@/lib/wire.shared", () => ({
  createWebLogger: () => ({ info: vi.fn(), errorWithException: vi.fn() }),
}));

import { POST } from "../route";
import {
  getModifyArchitectureUseCase,
  findMonorepoRoot,
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
});
