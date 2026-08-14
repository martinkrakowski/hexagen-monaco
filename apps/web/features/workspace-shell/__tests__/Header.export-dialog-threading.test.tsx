// GH-publish PR-2: Header derives the ExportDialog's errorCode /
// warningMessages / onReconnect from the export state machine. This test pins
// that derivation (destination guard included) by capturing the props the
// dialog receives — the dialog's own rendering is covered in
// features/export/__tests__/ExportDialog.test.tsx.

import { describe, it, vi, afterEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { render, cleanup } from "@testing-library/react";

const exportFlow = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));
const dialogProps = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

// Keep the REAL isGithubExportActive (pure, from export-state — no React/DI
// imports) so the `open` guard under test can't drift from production, while
// useProjectExport returns a controlled flow value.
vi.mock("@/contexts/ExportContext", async () => {
  const state = await import("@/contexts/export-state");
  return {
    isGithubExportActive: state.isGithubExportActive,
    useProjectExport: () => exportFlow.current,
  };
});
vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: vi.fn() }),
}));
vi.mock("@/contexts/ActiveWorkspaceContext", () => ({
  useActiveWorkspace: () => ({ activeWorkspace: { name: "acme" } }),
}));

// Sibling chrome stubbed; ExportDialog is replaced by a props recorder.
vi.mock("../HeaderMenu", () => ({
  HeaderMenu: () => <div data-testid="header-menu" />,
}));
vi.mock("../ProjectMenu", () => ({
  ProjectMenu: () => null,
}));
vi.mock("../ExportStatusStrip", () => ({
  ExportStatusStrip: () => null,
}));
vi.mock("../../export/PublishSettingsDialog", () => ({
  PublishSettingsDialog: () => null,
}));
vi.mock("../../export/ExportDialog", () => ({
  ExportDialog: (props: Record<string, unknown>) => {
    dialogProps.current = props;
    return null;
  },
}));

import { Header } from "../Header";

function flow(state: unknown) {
  return {
    state,
    canExport: true,
    isAuthenticated: true,
    connectedRepo: null,
    exportZip: vi.fn(),
    requestGithubExport: vi.fn(),
    openPublishSettings: vi.fn(),
    dismissStatus: vi.fn(),
    closeDialog: vi.fn(),
    submitGithubExport: vi.fn(),
    retryGithubExport: vi.fn(),
    showGithubDialog: vi.fn(),
    submitPublishSettings: vi.fn(),
    reconnectGithub: vi.fn(),
  };
}

function setup(state: unknown) {
  const f = flow(state);
  exportFlow.current = f;
  render(
    <Header
      onLoadManifest={vi.fn()}
      onNewProject={vi.fn()}
      onOpenWelcomeManifest={vi.fn()}
    />,
  );
  const props = dialogProps.current;
  assert.ok(props, "ExportDialog received props");
  return { f, props };
}

describe("Header — ExportDialog prop threading", () => {
  afterEach(() => {
    cleanup();
    dialogProps.current = null;
  });

  it("github error with a code → errorCode threads through, onReconnect fires the context action", () => {
    const { f, props } = setup({
      kind: "error",
      destination: "github",
      message: "GitHub rejected this push — the token lacks workflow scope.",
      code: "workflow_scope_required",
    });

    assert.strictEqual(props.open, true);
    assert.strictEqual(props.phase, "error");
    assert.match(String(props.error), /lacks workflow scope/);
    assert.strictEqual(props.errorCode, "workflow_scope_required");
    (props.onReconnect as () => void)();
    assert.strictEqual(f.reconnectGithub.mock.calls.length, 1);
  });

  it("github error without a code → errorCode is null (generic failures get no affordance)", () => {
    const { props } = setup({
      kind: "error",
      destination: "github",
      message: "Repository creation failed.",
    });

    assert.strictEqual(props.phase, "error");
    assert.strictEqual(props.errorCode, null);
  });

  it("zip error → dialog stays closed and carries no github error state", () => {
    const { props } = setup({
      kind: "error",
      destination: "zip",
      message: "ZIP export failed.",
    });

    assert.strictEqual(props.open, false);
    assert.strictEqual(props.phase, "form");
    assert.strictEqual(props.error, null);
    assert.strictEqual(props.errorCode, null);
  });

  it("github success → warningMessages and notices thread into the success payload", () => {
    const { props } = setup({
      kind: "success",
      destination: "github",
      message: "Pushed to me/r",
      githubLink: {
        owner: "me",
        repo: "r",
        branch: "main",
        defaultBranch: "main",
        lastCommitSha: null,
        htmlUrl: "https://github.com/me/r",
      },
      notices: { warnings: 1, errors: 0 },
      warnings: ["Skipped .github/workflows/sync-integrity.yml."],
    });

    assert.strictEqual(props.open, true);
    assert.strictEqual(props.phase, "success");
    const success = props.success as {
      owner?: string;
      repo?: string;
      notices?: unknown;
      warningMessages?: string[];
    };
    assert.strictEqual(success.owner, "me");
    assert.strictEqual(success.repo, "r");
    assert.deepStrictEqual(success.notices, { warnings: 1, errors: 0 });
    assert.deepStrictEqual(success.warningMessages, [
      "Skipped .github/workflows/sync-integrity.yml.",
    ]);
  });
});
