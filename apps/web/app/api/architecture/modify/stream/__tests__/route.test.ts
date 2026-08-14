import { describe, it, vi, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

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
import { findMonorepoRoot, MonorepoRootNotFoundError } from "@/lib/wire.server";

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/architecture/modify/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/architecture/modify/stream", () => {
  beforeEach(() => {
    vi.mocked(findMonorepoRoot).mockReturnValue("/fake/repo");
    vi.spyOn(process, "cwd").mockReturnValue("/fake/repo/apps/web");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 500 (not 400) when the monorepo-root/manifest anchor is missing", async () => {
    // A missing on-disk anchor is a server packaging/config failure; mapping it
    // to 400 would hide it from 5xx monitoring and blame the caller. The stream
    // route surfaces it as a one-shot SSE error frame with a 500 status.
    vi.mocked(findMonorepoRoot).mockImplementation(() => {
      throw new MonorepoRootNotFoundError(
        "Could not locate monorepo root from /x. No .architecture/manifest.yaml found.",
      );
    });

    const res = await POST(post({ intent: "add a context" }));

    assert.equal(res.status, 500);
    assert.equal(res.headers.get("Content-Type"), "text/event-stream");
  });

  it("still returns 400 for a path-traversal manifestPath (client input error)", async () => {
    const res = await POST(
      post({ intent: "add a context", manifestPath: "../../etc/passwd" }),
    );

    assert.equal(res.status, 400);
    assert.equal(res.headers.get("Content-Type"), "text/event-stream");
  });
});
