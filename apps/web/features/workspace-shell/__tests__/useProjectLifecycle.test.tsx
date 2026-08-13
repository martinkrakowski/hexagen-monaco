// crypto is a getter-only global in Node, so stub it via vi.stubGlobal (a plain
// `global.crypto =` throws "has only a getter"). localStorage/sessionStorage come
// from vitest.setup.ts's in-memory stub — no per-file Storage override needed.
vi.stubGlobal("crypto", {
  randomUUID: () => "test-uuid",
} as unknown as Crypto);

import { describe, it, vi, beforeEach } from "vitest";
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

// useSavedProjects (a transitive dep of useProjectLifecycle) loads projects from
// the persistence PORT on mount (async), and loadProject(id) reads that loaded
// state — NOT raw localStorage. Mock the port so a test can seed projects and
// the "load project" path resolves. getSavedProjectsPersistence MUST return a
// stable reference: it feeds a useEffect dep, so a fresh object per call would
// re-run the load every render.
const persistencePort = vi.hoisted(() => {
  const state: { projects: Array<Record<string, unknown>> } = { projects: [] };
  const port = {
    loadProjects: async () => ({ success: true, value: state.projects }),
    saveProjects: async () => ({ success: true, value: undefined }),
    // Record-level create/delete — the hook's saveProject/deleteProject write
    // through these (not whole-array saveProjects) since the ADR-0045 follow-up.
    createProjectRecord: async (project: Record<string, unknown>) => {
      state.projects = [project, ...state.projects];
      return { success: true as const, value: project };
    },
    deleteProjectRecord: async (id: string) => {
      state.projects = state.projects.filter((p) => p.id !== id);
      return { success: true as const, value: undefined };
    },
    // Minimal read-merge-write: updateProject autosaves through this (not
    // whole-array saveProjects) so a concurrent turn append can't be clobbered.
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
  return { state, port };
});
vi.mock("../../../app/lib/wire.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../app/lib/wire.client")>()),
  getMigrationReady: vi.fn(async () => {}),
  getSavedProjectsPersistence: vi.fn(() => persistencePort.port),
}));

import type { UseFormReturn } from "react-hook-form";
import type { ProjectConfig } from "@hexagen/project-configuration";
import type { UseWorkspaceShellUiReturn } from "../hooks/useWorkspaceShellUi";
import type { UseEditorSessionReturn } from "../hooks/useEditorSession";

import { useProjectLifecycle } from "../hooks/useProjectLifecycle";
import { emptyFormValues } from "../../project-wizard/config";

describe("useProjectLifecycle - Manifest Integration", () => {
  beforeEach(() => {
    persistencePort.state.projects = [];
    // Reset jsdom's URL so the URL-update test starts from a clean location.
    window.history.replaceState(null, "", "/");
  });

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

  // Un-quarantined (issue #335) after a behaviour review against the current
  // hook. `handleManifestLoaded` navigates to the manifest's first INCOMPLETE
  // step (analyzeManifestCompleteness), not a hardcoded step 0.
  it("should load manifest directly when in genesis mode", async () => {
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
    // First incomplete step for an empty-boundedContexts manifest = step 1
    // (step 0, the describe/genesis step, is satisfied once a manifest loads).
    assert.deepStrictEqual(mockOnGoToStep.mock.calls[0], [1]);
  });

  it("should update URL with project ID when loading project from within wizard", async () => {
    // Seed the mocked persistence port — useSavedProjects loads it on mount, and
    // loadProject(id) (which handleLoadProject calls) reads that loaded state.
    persistencePort.state.projects = [
      {
        id: "project-123",
        name: "Test Project",
        schemaVersion: 3,
        // Deep clone so the seeded fixture can't share nested refs with the
        // module-level emptyFormValues (isolation against downstream mutation).
        formState: structuredClone(emptyFormValues),
        manifestYaml: "boundedContexts: []\n",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];

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

    // The mount-load is async; loadProject(id) returns undefined until it lands,
    // so wait for the seeded project to surface before driving handleLoadProject.
    await waitFor(() => {
      assert.strictEqual(result.current.projects.length, 1);
    });

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
