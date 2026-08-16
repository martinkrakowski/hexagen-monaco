// GH-publish PR-2: Header derives the ExportDialog's errorCode /
// warningMessages / onReconnect from the publish state machine. This test pins
// that derivation by capturing the props the dialog receives — the dialog's own
// rendering is covered in features/export/__tests__/ExportDialog.test.tsx.
//
// GOD-004 removed the `destination === "github"` guard from every branch: the
// publish state machine no longer carries ZIP states, so the guard has nothing
// left to exclude. What replaced it — and what is pinned below — is the
// settings-modal case, the one publish state that must NOT open the create
// dialog.

import { describe, it, vi, afterEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { render, cleanup } from "@testing-library/react";

const publishFlow = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));
const dialogProps = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

// `@/contexts/export-state` is deliberately NOT mocked: isPublishDialogOpen is
// pure (no React/DI imports), so the `open` guard under test runs the real
// production selector and cannot drift from it.
vi.mock("@/contexts/GithubPublishContext", () => ({
  useGithubPublish: () => publishFlow.current,
}));
vi.mock("@/contexts/ZipExportContext", () => ({
  useZipExport: () => ({
    state: { kind: "idle" },
    canExport: true,
    exportZip: vi.fn(),
    dismissStatus: vi.fn(),
  }),
}));
vi.mock("@/contexts/ProjectExportRecordContext", () => ({
  useProjectExportRecord: () => ({ connectedRepo: null }),
}));
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
    isAuthenticated: true,
    isPublishing: (state as { kind?: string }).kind === "publishing",
    requestGithubExport: vi.fn(),
    openPublishSettings: vi.fn(),
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
  publishFlow.current = f;
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

  it("publish error with a code → errorCode threads through, onReconnect fires the context action", () => {
    const { f, props } = setup({
      kind: "error",
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

  it("publish error without a code → errorCode is null (generic failures get no affordance)", () => {
    const { props } = setup({
      kind: "error",
      message: "Repository creation failed.",
    });

    assert.strictEqual(props.phase, "error");
    assert.strictEqual(props.errorCode, null);
  });

  it("settings-open → the create dialog stays closed (the settings modal owns the screen)", () => {
    const { props } = setup({
      kind: "settings-open",
      repo: { owner: "me", repo: "r" },
      defaultMode: "scaffold",
      defaultMessage: "Update scaffold",
      defaultRemember: false,
      hasEditorEdits: false,
    });

    assert.strictEqual(props.open, false);
    assert.strictEqual(props.phase, "form");
    assert.strictEqual(props.error, null);
    assert.strictEqual(props.errorCode, null);
  });

  it("idle → the create dialog stays closed", () => {
    const { props } = setup({ kind: "idle" });

    assert.strictEqual(props.open, false);
    assert.strictEqual(props.phase, "form");
  });

  it("publish success → warningMessages and notices thread into the success payload", () => {
    const { props } = setup({
      kind: "success",
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
