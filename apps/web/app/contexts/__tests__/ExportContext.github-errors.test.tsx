// GH-publish PR-2: the provider's failure arms must thread the routes'
// snake_case error codes (workflow_scope_required / reauth_required) into the
// error state via mapGithubPublishFailure (NOT mocked here — it is pure), the
// success arm must carry the raw degraded-publish warning strings alongside
// the counts, and reconnectGithub must fire the integration context's signIn
// (the only token-refresh path — see the JSDoc on the context value).

import { describe, it, vi, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { render, act, waitFor, cleanup } from "@testing-library/react";

import {
  ExportProvider,
  useProjectExport,
  type ProjectExportContextValue,
} from "../ExportContext";

const harness = vi.hoisted(() => {
  const state = {
    projects: [] as Array<Record<string, unknown>>,
    loadCalls: 0,
    /** Editor workspace files returned to loadEditorFiles (push flow input). */
    editorFiles: {} as Record<string, { content: string }>,
  };
  const port = {
    loadProjects: async () => {
      state.loadCalls += 1;
      return { success: true as const, value: state.projects };
    },
    saveProjects: async () => ({ success: true as const, value: undefined }),
    updateProjectRecord: async (
      id: string,
      updater: (p: Record<string, unknown>) => Record<string, unknown>,
    ) => {
      const index = state.projects.findIndex((p) => p.id === id);
      if (index === -1) {
        return {
          success: false as const,
          error: { kind: "NotFound", message: `No saved project ${id}` },
        };
      }
      const updated = updater(state.projects[index]);
      state.projects = state.projects.map((p, i) =>
        i === index ? updated : p,
      );
      return { success: true as const, value: updated };
    },
  };
  const logger = {
    warn: () => {},
    error: () => {},
    info: () => {},
    debug: () => {},
    errorWithException: () => {},
  };
  const postJson = vi.fn();
  // Held in the harness (not created inside the mock factory) so every render
  // sees the SAME spy — reconnectGithub assertions need a stable reference.
  const signIn = vi.fn();
  return { state, port, logger, postJson, signIn };
});

// Full factories: the provider reads exactly these named exports, and no
// transitive dependency of this test needs the real wire.client DI container.
vi.mock("@/lib/wire.client", () => ({
  getSavedProjectsPersistence: () => harness.port,
  getEditorWorkspacePersistence: () => ({
    loadWorkspace: async () => ({
      success: true as const,
      value: { files: harness.state.editorFiles },
    }),
  }),
  getLogger: () => harness.logger,
}));
vi.mock("@/lib/fetch-json", () => ({
  postJson: harness.postJson,
  postForBlob: vi.fn(),
}));
vi.mock("@/contexts/ActiveWorkspaceContext", () => ({
  useActiveWorkspace: () => ({
    activeWorkspace: {
      projectId: "p1",
      name: "Vellum",
      isDirty: false,
      lastModifiedAt: 0,
    },
    setActiveWorkspace: vi.fn(),
    clearActiveWorkspace: vi.fn(),
  }),
}));
vi.mock("@/contexts/ExternalIntegrationContext", () => ({
  useExternalIntegration: () => ({
    isAuthenticated: true,
    signIn: harness.signIn,
  }),
}));

const serverLink = {
  owner: "me",
  repo: "r",
  branch: "main",
  defaultBranch: "main",
  lastCommitSha: null,
  htmlUrl: "https://github.com/me/r",
};

function seedProjects(options: { linked: boolean }) {
  harness.state.projects = [
    {
      id: "p1",
      name: "Vellum",
      formState: {},
      updatedAt: 1,
      ...(options.linked ? { githubLink: { ...serverLink } } : {}),
    },
  ];
}

let ctx: ProjectExportContextValue;
function Capture() {
  ctx = useProjectExport();
  return null;
}

/** Mount the provider and wait for its port-backed mount load to settle. */
async function renderProvider() {
  render(
    <ExportProvider>
      <Capture />
    </ExportProvider>,
  );
  await waitFor(() => {
    assert.ok(harness.state.loadCalls >= 1, "mount load ran");
  });
}

/** Mount with a LINKED project and wait for the link to hydrate, so runMode
 * dispatches the editor push instead of falling back to the create dialog. */
async function renderLinkedProvider() {
  seedProjects({ linked: true });
  harness.state.editorFiles = { "src/index.ts": { content: "export {};" } };
  await renderProvider();
  await waitFor(() => {
    assert.ok(ctx.connectedRepo !== null, "githubLink hydrated");
  });
}

/** Drive the editor-push flow through the public settings-submit entry. */
async function submitEditorPush() {
  await act(async () => {
    await ctx.submitPublishSettings({
      mode: "editor",
      commitMessage: "push edits",
      remember: false,
    });
  });
}

describe("ExportContext — GitHub publish/push error codes + degraded-publish warnings", () => {
  beforeEach(() => {
    seedProjects({ linked: false });
    harness.state.loadCalls = 0;
    harness.state.editorFiles = {};
    harness.postJson.mockReset();
    harness.signIn.mockReset();
  });
  afterEach(cleanup);

  it("scaffold publish 403 workflow_scope_required → error state carries the code and the server's message verbatim", async () => {
    const serverMessage =
      "GitHub rejected this push because it includes GitHub Actions workflow files. Reconnect GitHub to grant workflow permission, then retry.";
    harness.postJson.mockResolvedValue({
      kind: "http-error",
      status: 403,
      message: serverMessage,
      code: "workflow_scope_required",
    });
    await renderProvider();

    await act(async () => {
      await ctx.submitGithubExport({
        repoName: "r",
        isPrivate: false,
        commitMessage: "init",
      });
    });

    const state = ctx.state;
    assert.ok(state.kind === "error", "state is error");
    assert.strictEqual(state.destination, "github");
    // The workflow-scope server message is user-ready — passes through verbatim.
    assert.strictEqual(state.message, serverMessage);
    assert.strictEqual(state.code, "workflow_scope_required");
  });

  it("editor push 401 reauth_required → session-expired copy + code", async () => {
    harness.postJson.mockResolvedValue({
      kind: "http-error",
      status: 401,
      message: "Unauthorized: GitHub session token not found",
      code: "reauth_required",
    });
    await renderLinkedProvider();

    await submitEditorPush();

    const state = ctx.state;
    assert.ok(state.kind === "error", "state is error");
    assert.strictEqual(state.destination, "github");
    assert.strictEqual(
      state.message,
      "GitHub session expired — sign in again to push.",
    );
    assert.strictEqual(state.code, "reauth_required");
  });

  it("editor push codeless 401 → the exact pre-code session-expired copy (legacy fallback pinned)", async () => {
    harness.postJson.mockResolvedValue({
      kind: "http-error",
      status: 401,
      message: "Some raw server error",
      // No `code` — an older server (or a proxy-stripped body). The mapper's
      // fallback must preserve the pre-existing 401 client copy verbatim.
    });
    await renderLinkedProvider();

    await submitEditorPush();

    const state = ctx.state;
    assert.ok(state.kind === "error", "state is error");
    assert.strictEqual(
      state.message,
      "GitHub session expired — sign in again to push.",
    );
    assert.strictEqual(state.code, "reauth_required");
  });

  it("scaffold publish success with warnings → success state carries the raw strings AND the notice counts", async () => {
    const warnings = [
      "Skipped .github/workflows/sync-integrity.yml: the connected GitHub token lacks the 'workflow' scope.",
    ];
    harness.postJson.mockResolvedValue({
      kind: "success",
      data: {
        destinationUrl: "https://github.com/me/r",
        githubLink: { ...serverLink },
        warnings,
      },
    });
    await renderProvider();

    await act(async () => {
      await ctx.submitGithubExport({
        repoName: "r",
        isPrivate: false,
        commitMessage: "init",
      });
    });

    const state = ctx.state;
    assert.ok(state.kind === "success", "state is success");
    assert.strictEqual(state.destination, "github");
    assert.deepStrictEqual(state.warnings, warnings);
    assert.deepStrictEqual(state.notices, { warnings: 1, errors: 0 });
  });

  it("reconnectGithub() fires the integration context's signIn", async () => {
    await renderProvider();

    act(() => {
      ctx.reconnectGithub();
    });

    assert.strictEqual(harness.signIn.mock.calls.length, 1);
  });
});
