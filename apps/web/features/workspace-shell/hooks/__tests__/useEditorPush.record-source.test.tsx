// GOD-004 acceptance: the editor push reads the connected repo from the
// publish record, not a second IDB load. Against the pre-split tree this
// assertion measured 2 `loadProjects()` calls — the provider's and the hook's
// own effect — so the toolbar's copy of the link could disagree with the
// header menu's after a publish.
//
// Mounted through the real `ExportProvider` on purpose: stubbing the record
// context here would make the test pass by replacing the very collaborator the
// acceptance is about.

import { describe, it, vi, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { render, waitFor, cleanup } from "@testing-library/react";

import { ExportProvider } from "@/contexts/ExportContext";
import { useEditorPush } from "../useEditorPush";

const harness = vi.hoisted(() => {
  const state = {
    projects: [] as Array<Record<string, unknown>>,
    loadCalls: 0,
  };
  const port = {
    loadProjects: async () => {
      state.loadCalls += 1;
      return { success: true as const, value: state.projects };
    },
    saveProjects: async () => ({ success: true as const, value: undefined }),
    updateProjectRecord: async () => ({
      success: true as const,
      value: {} as Record<string, unknown>,
    }),
  };
  return { state, port };
});

vi.mock("@/lib/wire.client", () => ({
  getSavedProjectsPersistence: () => harness.port,
  getEditorWorkspacePersistence: () => ({
    loadWorkspace: async () => ({ success: true as const, value: null }),
  }),
  getLogger: () => ({
    warn: () => {},
    error: () => {},
    info: () => {},
    debug: () => {},
    errorWithException: () => {},
  }),
}));
vi.mock("@/lib/fetch-json", () => ({
  postJson: vi.fn(),
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
  useExternalIntegration: () => ({ isAuthenticated: true, signIn: vi.fn() }),
}));

const link = {
  owner: "me",
  repo: "r",
  branch: "main",
  defaultBranch: "main",
  lastCommitSha: null,
  htmlUrl: "https://github.com/me/r",
};

describe("useEditorPush — the connected repo comes from the publish record", () => {
  beforeEach(() => {
    harness.state.projects = [
      { id: "p1", name: "Vellum", formState: {}, githubLink: { ...link } },
    ];
    harness.state.loadCalls = 0;
  });
  afterEach(cleanup);

  it("mounting the workspace reads the saved-projects store exactly once", async () => {
    let repo: { owner: string; repo: string } | null = null;
    function Push() {
      repo = useEditorPush({
        projectId: "p1",
        files: { "a.ts": "x" },
        unpushed: true,
        onPushed: () => {},
      }).connectedRepo;
      return null;
    }

    render(
      <ExportProvider>
        <Push />
      </ExportProvider>,
    );
    await waitFor(() => {
      assert.ok(repo, "the hook resolved the connected repo");
    });

    assert.deepStrictEqual(repo, { owner: "me", repo: "r" });
    assert.strictEqual(
      harness.state.loadCalls,
      1,
      "the publish record is the only reader of the connected link",
    );
  });
});
