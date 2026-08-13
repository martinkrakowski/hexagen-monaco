import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import type { RepositoryWriterPort } from "@hexagen/external-integration";

// Mock the session boundary and the composition root; the route logic
// (validation + writer-error → HTTP mapping) runs for real.
vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));
vi.mock("@/lib/wire.server", () => ({ getRepositoryWriter: vi.fn() }));

import { POST } from "../route";
import { getToken } from "next-auth/jwt";
import { getRepositoryWriter } from "@/lib/wire.server";

const commitFiles = vi.fn<RepositoryWriterPort["commitFiles"]>();

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/push/github", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  projectId: "p1",
  githubLink: { owner: "octocat", repo: "hexagen-app", branch: "main" },
  files: { ".github/workflows/ci.yml": "name: ci\n" },
  message: "ci: add workflow",
};

describe("POST /api/push/github", () => {
  beforeEach(() => {
    vi.mocked(getToken).mockResolvedValue({
      accessToken: "gho_test",
      login: "octocat",
    } as never);
    vi.mocked(getRepositoryWriter).mockReturnValue({ commitFiles });
    commitFiles.mockReset();
  });

  it("maps workflow-scope-missing to 403 + workflow_scope_required (not reauth_required)", async () => {
    commitFiles.mockResolvedValue({
      success: false,
      error: {
        code: "workflow-scope-missing",
        message:
          "Pushing .github/workflows/ci.yml requires the 'workflow' OAuth scope.",
      },
    });

    const res = await POST(post(validBody));

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, "workflow_scope_required");
    assert.match(body.error, /workflow/);
  });

  it("still maps auth-failed to 401 + reauth_required", async () => {
    commitFiles.mockResolvedValue({
      success: false,
      error: { code: "auth-failed", message: "GitHub auth error" },
    });

    const res = await POST(post(validBody));

    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, "reauth_required");
  });

  it("keeps other writer errors on 500 with their own code", async () => {
    commitFiles.mockResolvedValue({
      success: false,
      error: { code: "conflict", message: "Branch moved" },
    });

    const res = await POST(post(validBody));

    assert.equal(res.status, 500);
    assert.equal((await res.json()).code, "conflict");
  });

  it("returns the commit sha/url on success", async () => {
    commitFiles.mockResolvedValue({
      success: true,
      value: {
        commitSha: "abc123",
        commitUrl: "https://github.com/octocat/hexagen-app/commit/abc123",
      },
    });

    const res = await POST(post(validBody));

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.commitSha, "abc123");
  });
});
