import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { ExportError } from "@hexagen/project-generation";
import type { GenerateProjectUseCase } from "@hexagen/project-generation";

// Mock the session boundary and the composition root; the real
// InitiateExportUseCase runs so the ExportError instance travels the same
// path it does in production before the route maps it.
vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));
vi.mock("@/lib/wire.server", () => ({ getGenerateProject: vi.fn() }));

import { POST } from "../route";
import { getToken } from "next-auth/jwt";
import { getGenerateProject } from "@/lib/wire.server";

const execute = vi.fn<GenerateProjectUseCase["execute"]>();

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/export/github", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  projectId: "p1",
  repoName: "hexagen-app",
  isPrivate: false,
  manifest: { system: "test-system" },
};

describe("POST /api/export/github", () => {
  beforeEach(() => {
    vi.mocked(getToken).mockResolvedValue({
      accessToken: "gho_test",
      login: "octocat",
    } as never);
    vi.mocked(getGenerateProject).mockReturnValue({
      execute,
    } as unknown as GenerateProjectUseCase);
    execute.mockReset();
  });

  it("maps a workflow-scope-missing ExportError to 403 + workflow_scope_required", async () => {
    execute.mockResolvedValue({
      success: false,
      error: new ExportError(
        "GitHub rejected this push because it includes GitHub Actions workflow files under .github/workflows/ and the connected GitHub token lacks the 'workflow' OAuth scope.",
        "workflow-scope-missing",
      ),
    });

    const res = await POST(post(validBody));

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, "workflow_scope_required");
    assert.match(body.error, /workflow/);
  });

  it("still maps a '(401)' GitHub auth failure to 401 + reauth_required", async () => {
    execute.mockResolvedValue({
      success: false,
      error: new ExportError(
        'GitHub API error (401): {"message":"Bad credentials"}',
      ),
    });

    const res = await POST(post(validBody));

    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, "reauth_required");
  });

  it("does NOT misroute an untyped workflow-ish failure to reauth_required (remap text carries no parenthesized status)", async () => {
    // Regression guard for the /\((401|403)\)/ regex: a message mentioning the
    // workflow scope but carrying no typed code and no "(401)"/"(403)" must
    // fall through to 500, never to a re-login prompt.
    execute.mockResolvedValue({
      success: false,
      error: new Error(
        "GitHub rejected this push over workflow files; reconnect GitHub to grant workflow permission.",
      ),
    });

    const res = await POST(post(validBody));

    assert.equal(res.status, 500);
    assert.equal((await res.json()).code, undefined);
  });

  it("forwards exporter warnings (degraded publish) on the success response", async () => {
    execute.mockResolvedValue({
      success: true,
      value: {
        project: { rootName: "hexagen-app" },
        destinationUrl: "https://github.com/octocat/hexagen-app",
        defaultBranch: "main",
        warnings: [
          "Skipped .github/workflows/sync-integrity.yml: the connected GitHub token lacks the 'workflow' scope.",
        ],
      },
    } as never);

    const res = await POST(post(validBody));

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.warnings.length, 1);
    assert.match(body.warnings[0], /workflows\/sync-integrity\.yml/);
    assert.equal(body.githubLink.branch, "main");
  });
});
