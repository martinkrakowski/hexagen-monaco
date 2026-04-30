import { JSDOM } from "jsdom";
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { url: "http://localhost/" });
global.window = dom.window as unknown as Window & typeof globalThis;
global.document = dom.window.document as unknown as Document;
global.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
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

    const mockUi = {
      currentStepIndex: 0,
      openDialog: mock.fn(),
      closeDialog: mock.fn(),
      setStep: mock.fn(),
      enterEditMode: mock.fn(),
      enterGenesisMode: mock.fn(),
    } as unknown as UseWorkspaceShellUiReturn;

    const mockEditor = {
      setSessionId: mock.fn(),
      clearSession: mock.fn(),
      setActiveWorkspace: mock.fn(),
      clearActiveWorkspace: mock.fn(),
    } as unknown as Pick<UseEditorSessionReturn, "setSessionId" | "clearSession" | "setActiveWorkspace" | "clearActiveWorkspace">;

    const { result } = renderHook(() =>
      useProjectLifecycle({
        form: mockForm,
        ui: mockUi,
        uiState: { kind: "edit", projectId: "123" },
        editor: mockEditor,
        totalSteps: 4,
      })
    );

    const testManifest = "boundedContexts: []\n";
    
    await act(async () => {
      await result.current.handleWelcomeManifestGenerated(testManifest);
    });

    assert.strictEqual(mockUi.openDialog.mock.callCount(), 1);
    assert.deepStrictEqual(mockUi.openDialog.mock.calls[0].arguments, [{ kind: "new-project" }]);
    assert.strictEqual(mockForm.reset.mock.callCount(), 0);

    // Now test save and new to verify pending manifest is loaded
    await act(async () => {
      await result.current.handleSaveAndNew();
    });

    await waitFor(() => {
      assert.strictEqual(mockForm.reset.mock.callCount(), 1);
    });
    
    // reset should have been called with the parsed manifest values
    const resetArgs = mockForm.reset.mock.calls[0].arguments[0];
    assert.deepStrictEqual(resetArgs.boundedContexts, []);
    assert.strictEqual(mockUi.closeDialog.mock.callCount(), 1);
    assert.strictEqual(mockUi.setStep.mock.callCount(), 1);
    assert.deepStrictEqual(mockUi.setStep.mock.calls[0].arguments, [0]);
  });

  it("should load manifest directly when in genesis mode", async () => {
    const mockForm = {
      getValues: mock.fn(() => emptyFormValues),
      reset: mock.fn(),
      trigger: mock.fn(async () => true),
    } as unknown as UseFormReturn<ProjectConfig>;

    const mockUi = {
      currentStepIndex: 0,
      openDialog: mock.fn(),
      closeDialog: mock.fn(),
      setStep: mock.fn(),
      enterEditMode: mock.fn(),
      enterGenesisMode: mock.fn(),
    } as unknown as UseWorkspaceShellUiReturn;

    const mockEditor = {
      setSessionId: mock.fn(),
      clearSession: mock.fn(),
      setActiveWorkspace: mock.fn(),
      clearActiveWorkspace: mock.fn(),
    } as unknown as Pick<UseEditorSessionReturn, "setSessionId" | "clearSession" | "setActiveWorkspace" | "clearActiveWorkspace">;

    const { result } = renderHook(() =>
      useProjectLifecycle({
        form: mockForm,
        ui: mockUi,
        uiState: { kind: "genesis" },
        editor: mockEditor,
        totalSteps: 4,
      })
    );

    const testManifest = "boundedContexts: []\n";
    
    await act(async () => {
      await result.current.handleWelcomeManifestGenerated(testManifest);
    });

    assert.strictEqual(mockUi.openDialog.mock.callCount(), 0); // shouldn't open new-project
    
    await waitFor(() => {
      assert.strictEqual(mockForm.reset.mock.callCount(), 1);
    });

    const resetArgs = mockForm.reset.mock.calls[0].arguments[0];
    assert.deepStrictEqual(resetArgs.boundedContexts, []);
    assert.strictEqual(mockUi.closeDialog.mock.callCount(), 1);
    assert.strictEqual(mockUi.setStep.mock.callCount(), 1);
    assert.deepStrictEqual(mockUi.setStep.mock.calls[0].arguments, [0]);
  });
});
