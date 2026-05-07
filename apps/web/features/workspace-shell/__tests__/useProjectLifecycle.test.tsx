import { JSDOM } from "jsdom";
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  url: "http://localhost/",
});
global.window = dom.window as unknown as Window & typeof globalThis;
global.document = dom.window.document as unknown as Document;
const store: Record<string, string> = {};
global.localStorage = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => {
    store[key] = value;
  },
  removeItem: (key: string) => {
    delete store[key];
  },
  clear: () => {
    for (const k of Object.keys(store)) delete store[k];
  },
  length: 0,
  key: () => null,
} as unknown as Storage;
global.crypto = {
  randomUUID: () => "test-uuid",
} as unknown as Crypto;

import { describe, it, mock } from "node:test";
import assert from "node:assert";
import { renderHook, act, waitFor } from "@testing-library/react";

import * as wireModule from "../../../app/lib/wire";
mock.method(wireModule, "getEventBus", () => ({
  publish: mock.fn(),
  subscribe: mock.fn(),
}));
mock.method(wireModule, "getChatPersistence", () => ({
  purgeProjectData: mock.fn(async () => {}),
}));

import type { UseFormReturn } from "react-hook-form";
import type { ProjectConfig } from "@hexagen/project-configuration";
import type { UseWorkspaceShellUiReturn } from "../hooks/useWorkspaceShellUi";
import type { UseEditorSessionReturn } from "../hooks/useEditorSession";

import { useProjectLifecycle } from "../hooks/useProjectLifecycle";
import { emptyFormValues } from "../../project-wizard/config";

describe("useProjectLifecycle - Welcome Manifest Integration", () => {
  it("should trigger new-project dialog when in edit mode", async () => {
    const mockForm = {
      getValues: mock.fn(() => emptyFormValues),
      reset: mock.fn(),
      trigger: mock.fn(async () => true),
    } as unknown as UseFormReturn<ProjectConfig>;

    const mockOnGoToStep = mock.fn();

    const mockUi = {
      currentStepIndex: 0,
      viewMode: "visual" as const,
      openDialog: mock.fn(),
      closeDialog: mock.fn(),
      setContextId: mock.fn(),
      setMappingId: mock.fn(),
      enterEditMode: mock.fn(),
      enterGenesisMode: mock.fn(),
    } as unknown as UseWorkspaceShellUiReturn;

    const mockEditor = {
      setSessionId: mock.fn(),
      clearSession: mock.fn(),
      setActiveWorkspace: mock.fn(),
      clearActiveWorkspace: mock.fn(),
    } as unknown as Pick<
      UseEditorSessionReturn,
      | "setSessionId"
      | "clearSession"
      | "setActiveWorkspace"
      | "clearActiveWorkspace"
    >;

    const { result } = renderHook(() =>
      useProjectLifecycle({
        form: mockForm,
        ui: mockUi,
        uiState: { kind: "edit", projectId: "123" },
        editor: mockEditor,
        totalSteps: 4,
        onGoToStep: mockOnGoToStep,
      }),
    );

    const testManifest = "boundedContexts: []\n";

    await act(async () => {
      await result.current.handleWelcomeManifestGenerated(testManifest);
    });

    assert.strictEqual(mockUi.openDialog.mock.callCount(), 1);
    assert.deepStrictEqual(mockUi.openDialog.mock.calls[0].arguments, [
      { kind: "new-project" },
    ]);
    assert.strictEqual(mockForm.reset.mock.callCount(), 0);

    await act(async () => {
      await result.current.handleSaveAndNew();
    });

    await waitFor(() => {
      assert.strictEqual(mockForm.reset.mock.callCount(), 1);
    });

    const resetArgs = mockForm.reset.mock.calls[0].arguments[0];
    assert.deepStrictEqual(resetArgs.boundedContexts, []);
    assert.strictEqual(mockUi.closeDialog.mock.callCount(), 1);
    assert.strictEqual(mockOnGoToStep.mock.callCount(), 1);
    assert.deepStrictEqual(mockOnGoToStep.mock.calls[0].arguments, [0]);
  });

  it("should load manifest directly when in genesis mode", async () => {
    const mockForm = {
      getValues: mock.fn(() => emptyFormValues),
      reset: mock.fn(),
      trigger: mock.fn(async () => true),
    } as unknown as UseFormReturn<ProjectConfig>;

    const mockOnGoToStep = mock.fn();

    const mockUi = {
      currentStepIndex: 0,
      viewMode: "visual" as const,
      openDialog: mock.fn(),
      closeDialog: mock.fn(),
      setContextId: mock.fn(),
      setMappingId: mock.fn(),
      enterEditMode: mock.fn(),
      enterGenesisMode: mock.fn(),
    } as unknown as UseWorkspaceShellUiReturn;

    const mockEditor = {
      setSessionId: mock.fn(),
      clearSession: mock.fn(),
      setActiveWorkspace: mock.fn(),
      clearActiveWorkspace: mock.fn(),
    } as unknown as Pick<
      UseEditorSessionReturn,
      | "setSessionId"
      | "clearSession"
      | "setActiveWorkspace"
      | "clearActiveWorkspace"
    >;

    const { result } = renderHook(() =>
      useProjectLifecycle({
        form: mockForm,
        ui: mockUi,
        uiState: { kind: "genesis" },
        editor: mockEditor,
        totalSteps: 4,
        onGoToStep: mockOnGoToStep,
      }),
    );

    const testManifest = "boundedContexts: []\n";

    await act(async () => {
      await result.current.handleWelcomeManifestGenerated(testManifest);
    });

    assert.strictEqual(mockUi.openDialog.mock.callCount(), 0);

    await waitFor(() => {
      assert.strictEqual(mockForm.reset.mock.callCount(), 1);
    });

    const resetArgs = mockForm.reset.mock.calls[0].arguments[0];
    assert.deepStrictEqual(resetArgs.boundedContexts, []);
    assert.strictEqual(mockUi.closeDialog.mock.callCount(), 1);
    assert.strictEqual(mockOnGoToStep.mock.callCount(), 1);
    assert.deepStrictEqual(mockOnGoToStep.mock.calls[0].arguments, [0]);
  });

  it("should persist project when AI generation completes in genesis mode", async () => {
    for (const k of Object.keys(store)) delete store[k];

    const mockForm = {
      getValues: mock.fn(() => emptyFormValues),
      reset: mock.fn(),
      trigger: mock.fn(async () => true),
    } as unknown as UseFormReturn<ProjectConfig>;

    const mockOnGoToStep = mock.fn();

    const mockUi = {
      currentStepIndex: 0,
      viewMode: "visual" as const,
      openDialog: mock.fn(),
      closeDialog: mock.fn(),
      setContextId: mock.fn(),
      setMappingId: mock.fn(),
      enterEditMode: mock.fn(),
      enterGenesisMode: mock.fn(),
    } as unknown as UseWorkspaceShellUiReturn;

    const mockEditor = {
      setSessionId: mock.fn(),
      clearSession: mock.fn(),
      setActiveWorkspace: mock.fn(),
      clearActiveWorkspace: mock.fn(),
    } as unknown as Pick<
      UseEditorSessionReturn,
      | "setSessionId"
      | "clearSession"
      | "setActiveWorkspace"
      | "clearActiveWorkspace"
    >;

    const { result } = renderHook(() =>
      useProjectLifecycle({
        form: mockForm,
        ui: mockUi,
        uiState: { kind: "genesis" },
        editor: mockEditor,
        totalSteps: 4,
        onGoToStep: mockOnGoToStep,
      }),
    );

    const testManifest = "system: verdant-sentinel\nboundedContexts: []\n";

    await act(async () => {
      await result.current.handleWelcomeManifestGenerated(testManifest);
    });

    await waitFor(() => {
      assert.strictEqual(mockForm.reset.mock.callCount(), 1);
    });

    const stored = JSON.parse(store["hexagen-saved-projects"] ?? "[]");
    assert.strictEqual(stored.length, 1);
    assert.strictEqual(stored[0].name, "Verdant Sentinel");
    assert.ok(stored[0].manifestYaml.includes("verdant-sentinel"));

    assert.strictEqual(mockEditor.setActiveWorkspace.mock.callCount(), 1);
    const ws = mockEditor.setActiveWorkspace.mock.calls[0].arguments[0];
    assert.strictEqual(ws.name, "Verdant Sentinel");
    assert.strictEqual(ws.isDirty, false);
  });

  it("should not open resume-draft dialog when hasProjectUrlParam is true", async () => {
    for (const k of Object.keys(store)) delete store[k];

    const mockForm = {
      getValues: mock.fn(() => emptyFormValues),
      reset: mock.fn(),
      trigger: mock.fn(async () => true),
    } as unknown as UseFormReturn<ProjectConfig>;

    const mockOnGoToStep = mock.fn();

    const mockUi = {
      currentStepIndex: 0,
      viewMode: "visual" as const,
      openDialog: mock.fn(),
      closeDialog: mock.fn(),
      setContextId: mock.fn(),
      setMappingId: mock.fn(),
      enterEditMode: mock.fn(),
      enterGenesisMode: mock.fn(),
    } as unknown as UseWorkspaceShellUiReturn;

    const mockEditor = {
      setSessionId: mock.fn(),
      clearSession: mock.fn(),
      setActiveWorkspace: mock.fn(),
      clearActiveWorkspace: mock.fn(),
    } as unknown as Pick<
      UseEditorSessionReturn,
      | "setSessionId"
      | "clearSession"
      | "setActiveWorkspace"
      | "clearActiveWorkspace"
    >;

    renderHook(() =>
      useProjectLifecycle({
        form: mockForm,
        ui: mockUi,
        uiState: { kind: "genesis" },
        editor: mockEditor,
        totalSteps: 4,
        onGoToStep: mockOnGoToStep,
        hasProjectUrlParam: true,
      }),
    );

    await waitFor(() => {
      assert.strictEqual(mockUi.openDialog.mock.callCount(), 0);
    });
  });

  it("should update URL with project ID when loading project from within wizard", async () => {
    for (const k of Object.keys(store)) delete store[k];

    // Setup: save a test project
    const testProject = {
      id: "project-123",
      name: "Test Project",
      formState: { ...emptyFormValues },
      manifestYaml: "boundedContexts: []\n",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    store["hexagen-saved-projects"] = JSON.stringify([testProject]);

    const mockForm = {
      getValues: mock.fn(() => emptyFormValues),
      reset: mock.fn(),
      trigger: mock.fn(async () => true),
    } as unknown as UseFormReturn<ProjectConfig>;

    const mockOnGoToStep = mock.fn();

    const mockUi = {
      currentStepIndex: 0,
      viewMode: "visual" as const,
      openDialog: mock.fn(),
      closeDialog: mock.fn(),
      setContextId: mock.fn(),
      setMappingId: mock.fn(),
      enterEditMode: mock.fn(),
      enterGenesisMode: mock.fn(),
    } as unknown as UseWorkspaceShellUiReturn;

    const mockEditor = {
      setSessionId: mock.fn(),
      clearSession: mock.fn(),
      setActiveWorkspace: mock.fn(),
      clearActiveWorkspace: mock.fn(),
    } as unknown as Pick<
      UseEditorSessionReturn,
      | "setSessionId"
      | "clearSession"
      | "setActiveWorkspace"
      | "clearActiveWorkspace"
    >;

    const { result } = renderHook(() =>
      useProjectLifecycle({
        form: mockForm,
        ui: mockUi,
        uiState: { kind: "genesis" },
        editor: mockEditor,
        totalSteps: 4,
        onGoToStep: mockOnGoToStep,
      }),
    );

    // Get initial URL
    const initialUrl = window.location.href;
    assert.strictEqual(initialUrl, "http://localhost/");

    // Load project from within wizard
    await act(async () => {
      await result.current.handleLoadProject("project-123");
    });

    // Verify URL was updated with project param
    const newUrl = window.location.href;
    assert.strictEqual(newUrl, "http://localhost/?project=project-123");
    assert.strictEqual(mockEditor.setActiveWorkspace.mock.callCount(), 1);
  });
});
