// GOD-004 acceptance: ZIP consumers do not subscribe to GitHub dialog state.
// While one context value carried both flows, opening the publish dialog — a
// surface the ZIP path never renders — re-rendered every ZIP consumer
// (measured against the pre-split provider: 3 renders where 2 were expected).
// The split is only worth doing if the coupling it removes is observable.
//
// The companion half of the acceptance — the connected repo being loaded once
// rather than twice — lives in
// features/workspace-shell/hooks/__tests__/useEditorPush.record-source.test.tsx,
// because asserting it requires mounting a slice hook and a neutral module
// must not import from features/ (ADR-0055 §Decision 2).

import { describe, it, vi, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { render, act, waitFor, cleanup } from "@testing-library/react";

import { ExportProvider } from "../ExportContext";
import { useZipExport } from "../ZipExportContext";
import { useGithubPublish } from "../GithubPublishContext";

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

describe("ExportProvider — the GOD-004 split is observable", () => {
  beforeEach(() => {
    harness.state.projects = [
      { id: "p1", name: "Vellum", formState: {}, githubLink: { ...link } },
    ];
    harness.state.loadCalls = 0;
  });
  afterEach(cleanup);

  it("opening the GitHub publish dialog does not re-render a ZIP-only consumer", async () => {
    let zipRenders = 0;
    let openDialog!: () => void;

    function ZipConsumer() {
      zipRenders += 1;
      useZipExport();
      return null;
    }
    function PublishConsumer() {
      openDialog = useGithubPublish().showGithubDialog;
      return null;
    }

    render(
      <ExportProvider>
        <ZipConsumer />
        <PublishConsumer />
      </ExportProvider>,
    );
    await waitFor(() => {
      assert.ok(harness.state.loadCalls >= 1, "mount load ran");
    });

    const before = zipRenders;
    act(() => {
      openDialog();
    });

    assert.ok(before > 0, "the ZIP consumer actually rendered");
    assert.strictEqual(
      zipRenders,
      before,
      "opening the publish dialog must not re-render a ZIP-only consumer",
    );
  });
});
