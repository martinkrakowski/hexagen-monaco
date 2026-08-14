// GH-publish PR-2: the editor-push error strip's Reconnect/sign-in affordance
// is wired through useEditorPush's pushErrorCode and the shared
// ExternalIntegrationContext signIn. Container test per repo idiom (mocked
// hook seams, stubbed heavy children) so deleting that wiring fails a test —
// the mapper and hook are unit-tested elsewhere, this covers the pane itself.

import { describe, it, vi, afterEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";

const push = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));
const integration = vi.hoisted(() => ({
  signIn: vi.fn(async () => {}),
}));

// Hook seams (paths resolve relative to this test file).
vi.mock("../contexts/WizardLifecycleContext", () => ({
  useWizardData: () => ({}),
}));
vi.mock("../hooks/useEditorPush", () => ({
  useEditorPush: () => push.current,
}));
vi.mock("@/contexts/ActiveWorkspaceContext", () => ({
  useActiveWorkspace: () => ({
    activeWorkspace: { projectId: "p1", name: "acme" },
  }),
}));
vi.mock("@/contexts/ExternalIntegrationContext", () => ({
  useExternalIntegration: () => integration,
}));

// Heavy children stubbed out — the strip under test is a SIBLING of CodeView
// in the code-view branch, not inside it, so stubs don't hide the subject.
vi.mock("../../hexagon-canvas/GraphCanvasWrapper", () => ({
  GraphCanvasWrapper: () => <div data-testid="graph-canvas" />,
}));
vi.mock("../../code-view/CodeView", () => ({
  CodeView: () => <div data-testid="code-view" />,
}));
vi.mock("../../monaco-editor/EditableMonaco", () => ({
  EditableMonaco: () => null,
}));

import { ArchitecturePreviewPane } from "../ArchitecturePreviewPane";

function pushState(overrides: Record<string, unknown> = {}) {
  return {
    onPush: vi.fn(),
    canPush: false,
    isPushing: false,
    connectedRepo: null,
    pushError: null,
    pushErrorCode: null,
    ...overrides,
  };
}

function setup(viewMode: "visual" | "code" = "code") {
  render(
    <ArchitecturePreviewPane
      viewMode={viewMode}
      selectedFileId={null}
      editedFiles={{}}
      unpushed={false}
      onViewModeChange={vi.fn()}
      onFileSelect={vi.fn()}
      onFileContentChange={vi.fn()}
      onFileSave={vi.fn()}
      onPushed={vi.fn()}
    />,
  );
}

const alertStrip = () => document.querySelector('[role="alert"]');
const stripButton = () => alertStrip()?.querySelector("button") ?? null;

describe("ArchitecturePreviewPane — push-error reconnect affordance", () => {
  afterEach(() => {
    cleanup();
    integration.signIn.mockClear();
  });

  it("workflow_scope_required → 'Reconnect GitHub' button fires the shared signIn", () => {
    push.current = pushState({
      pushError: "GitHub rejected this push — the token lacks workflow scope.",
      pushErrorCode: "workflow_scope_required",
    });
    setup();

    const strip = alertStrip();
    assert.ok(strip, "the error strip renders");
    assert.match(strip.textContent || "", /lacks workflow scope/);
    const btn = stripButton();
    assert.ok(btn, "the reconnect button renders");
    assert.strictEqual(btn.textContent, "Reconnect GitHub");
    fireEvent.click(btn);
    assert.strictEqual(integration.signIn.mock.calls.length, 1);
  });

  it("reauth_required → 'Sign in to GitHub' label on the same signIn wiring", () => {
    push.current = pushState({
      pushError: "GitHub session expired — sign in again to push.",
      pushErrorCode: "reauth_required",
    });
    setup();

    const btn = stripButton();
    assert.ok(btn, "the sign-in button renders");
    assert.strictEqual(btn.textContent, "Sign in to GitHub");
    fireEvent.click(btn);
    assert.strictEqual(integration.signIn.mock.calls.length, 1);
  });

  it("codeless failure → the message renders with no action button", () => {
    push.current = pushState({
      pushError: "GitHub push failed: the remote branch moved ahead.",
      pushErrorCode: null,
    });
    setup();

    const strip = alertStrip();
    assert.ok(strip, "the error strip renders");
    assert.match(strip.textContent || "", /remote branch moved ahead/);
    assert.strictEqual(stripButton(), null);
  });

  it("no pushError → no strip in the code view", () => {
    push.current = pushState();
    setup();
    assert.strictEqual(alertStrip(), null);
  });
});
