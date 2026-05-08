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

describe("useProjectLifecycle - Manifest Integration", () => {
  it("should save and start new project in edit mode", async () => {
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

    await act(async () => {
      await result.current.handleSaveAndNew();
    });

    await waitFor(() => {
      assert.strictEqual(mockForm.reset.mock.callCount(), 1);
    });

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
      await result.current.handleManifestLoaded(testManifest);
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

  it("should update URL with project ID when loading project from within wizard", async () => {
    for (const k of Object.keys(store)) delete store[k];

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

    const initialUrl = window.location.href;
    assert.strictEqual(initialUrl, "http://localhost/");

    await act(async () => {
      await result.current.handleLoadProject("project-123");
    });

    const newUrl = window.location.href;
    assert.strictEqual(newUrl, "http://localhost/?project=project-123");
    assert.strictEqual(mockEditor.setActiveWorkspace.mock.callCount(), 1);
  });
});
