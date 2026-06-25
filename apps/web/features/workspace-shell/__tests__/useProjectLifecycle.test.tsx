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
// crypto is a getter-only global in Node, so assign it via stubGlobal rather
// than `global.crypto = …` (which throws "has only a getter" under Vitest).
vi.stubGlobal("crypto", {
  randomUUID: () => "test-uuid",
} as unknown as Crypto);

import { describe, it, vi } from "vitest";
import assert from "node:assert";
import { renderHook, act, waitFor } from "@testing-library/react";
import { ActiveWorkspaceProvider } from "../../../app/contexts/ActiveWorkspaceContext";

// wire is an `import * as` namespace whose exports are non-configurable under
// Vite, so vi.spyOn would throw "Cannot redefine property" (node:test's
// mock.method tolerated it). Replace the module with vi.mock instead, keeping
// the real exports and overriding only the two factories these tests drive.
vi.mock("../../../app/lib/wire", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../app/lib/wire")>()),
  getEventBus: vi.fn(() => ({ publish: vi.fn(), subscribe: vi.fn() })),
  getChatPersistence: vi.fn(() => ({
    purgeProjectData: vi.fn(async () => {}),
  })),
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
      getValues: vi.fn(() => emptyFormValues),
      reset: vi.fn(),
      trigger: vi.fn(async () => true),
    } as unknown as UseFormReturn<ProjectConfig>;

    const mockOnGoToStep = vi.fn();

    const mockUi = {
      currentStepIndex: 0,
      viewMode: "visual" as const,
      openDialog: vi.fn(),
      closeDialog: vi.fn(),
      setContextId: vi.fn(),
      setMappingId: vi.fn(),
      enterEditMode: vi.fn(),
      enterGenesisMode: vi.fn(),
    } as unknown as UseWorkspaceShellUiReturn;

    const mockEditor = {
      setSessionId: vi.fn(),
      clearSession: vi.fn(),
      setActiveWorkspace: vi.fn(),
      clearActiveWorkspace: vi.fn(),
    } as unknown as Pick<
      UseEditorSessionReturn,
      | "setSessionId"
      | "clearSession"
      | "setActiveWorkspace"
      | "clearActiveWorkspace"
    >;

    const { result } = renderHook(
      () =>
        useProjectLifecycle({
          form: mockForm,
          ui: mockUi,
          uiState: { kind: "edit", projectId: "123" },
          editor: mockEditor,
          totalSteps: 4,
          onGoToStep: mockOnGoToStep,
        }),
      { wrapper: ActiveWorkspaceProvider },
    );

    await act(async () => {
      await result.current.handleSaveAndNew();
    });

    await waitFor(() => {
      assert.strictEqual(mockForm.reset.mock.calls.length, 1);
    });

    assert.strictEqual(mockUi.closeDialog.mock.calls.length, 1);
    assert.strictEqual(mockOnGoToStep.mock.calls.length, 1);
    assert.deepStrictEqual(mockOnGoToStep.mock.calls[0], [0]);
  });

  // QUARANTINED (issue #335): these two never ran under the old `**/*.test.ts`
  // glob and assert unvalidated behavior — the genesis-mode navigation target
  // (which step onGoToStep receives) and a jsdom window.location URL update. They
  // need a behavior review (test vs. hook) before being un-skipped.
  it.skip("should load manifest directly when in genesis mode", async () => {
    const mockForm = {
      getValues: vi.fn(() => emptyFormValues),
      reset: vi.fn(),
      trigger: vi.fn(async () => true),
    } as unknown as UseFormReturn<ProjectConfig>;

    const mockOnGoToStep = vi.fn();

    const mockUi = {
      currentStepIndex: 0,
      viewMode: "visual" as const,
      openDialog: vi.fn(),
      closeDialog: vi.fn(),
      setContextId: vi.fn(),
      setMappingId: vi.fn(),
      enterEditMode: vi.fn(),
      enterGenesisMode: vi.fn(),
    } as unknown as UseWorkspaceShellUiReturn;

    const mockEditor = {
      setSessionId: vi.fn(),
      clearSession: vi.fn(),
      setActiveWorkspace: vi.fn(),
      clearActiveWorkspace: vi.fn(),
    } as unknown as Pick<
      UseEditorSessionReturn,
      | "setSessionId"
      | "clearSession"
      | "setActiveWorkspace"
      | "clearActiveWorkspace"
    >;

    const { result } = renderHook(
      () =>
        useProjectLifecycle({
          form: mockForm,
          ui: mockUi,
          uiState: { kind: "genesis" },
          editor: mockEditor,
          totalSteps: 4,
          onGoToStep: mockOnGoToStep,
        }),
      { wrapper: ActiveWorkspaceProvider },
    );

    const testManifest = "boundedContexts: []\n";

    await act(async () => {
      await result.current.handleManifestLoaded(testManifest);
    });

    await waitFor(() => {
      assert.strictEqual(mockForm.reset.mock.calls.length, 1);
    });

    const resetArgs = mockForm.reset.mock.calls[0][0];
    assert.deepStrictEqual(resetArgs.boundedContexts, []);
    assert.strictEqual(mockUi.closeDialog.mock.calls.length, 1);
    assert.strictEqual(mockOnGoToStep.mock.calls.length, 1);
    assert.deepStrictEqual(mockOnGoToStep.mock.calls[0], [0]);
  });

  it.skip("should update URL with project ID when loading project from within wizard", async () => {
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
      getValues: vi.fn(() => emptyFormValues),
      reset: vi.fn(),
      trigger: vi.fn(async () => true),
    } as unknown as UseFormReturn<ProjectConfig>;

    const mockOnGoToStep = vi.fn();

    const mockUi = {
      currentStepIndex: 0,
      viewMode: "visual" as const,
      openDialog: vi.fn(),
      closeDialog: vi.fn(),
      setContextId: vi.fn(),
      setMappingId: vi.fn(),
      enterEditMode: vi.fn(),
      enterGenesisMode: vi.fn(),
    } as unknown as UseWorkspaceShellUiReturn;

    const mockEditor = {
      setSessionId: vi.fn(),
      clearSession: vi.fn(),
      setActiveWorkspace: vi.fn(),
      clearActiveWorkspace: vi.fn(),
    } as unknown as Pick<
      UseEditorSessionReturn,
      | "setSessionId"
      | "clearSession"
      | "setActiveWorkspace"
      | "clearActiveWorkspace"
    >;

    const { result } = renderHook(
      () =>
        useProjectLifecycle({
          form: mockForm,
          ui: mockUi,
          uiState: { kind: "genesis" },
          editor: mockEditor,
          totalSteps: 4,
          onGoToStep: mockOnGoToStep,
        }),
      { wrapper: ActiveWorkspaceProvider },
    );

    const initialUrl = window.location.href;
    assert.strictEqual(initialUrl, "http://localhost/");

    await act(async () => {
      await result.current.handleLoadProject("project-123");
    });

    const newUrl = window.location.href;
    assert.strictEqual(newUrl, "http://localhost/?project=project-123");
    assert.strictEqual(mockEditor.setActiveWorkspace.mock.calls.length, 1);
  });
});
