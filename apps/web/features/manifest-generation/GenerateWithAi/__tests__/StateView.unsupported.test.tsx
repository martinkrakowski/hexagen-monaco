import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { StateView } from "../StateView";
import type { ModelSelectionFlowActions } from "../../ModelSelectionFlow/types";
import type { ModelSelectionFlowState } from "../../ModelSelectionFlow/types";

function makeActions(): ModelSelectionFlowActions {
  return {
    transitionTo: vi.fn(),
    selectLocalModel: vi.fn(),
    selectCloudProvider: vi.fn(),
    skipAiSetup: vi.fn(),
    cancelModelDownload: vi.fn(),
    setError: vi.fn(),
    clearError: vi.fn(),
    retryGeneration: vi.fn(),
    restartFromSelection: vi.fn(),
    proceedToWizard: vi.fn(),
    clearStoredApiKey: vi.fn(async () => undefined),
    validateApiKey: vi.fn(async () => true),
    loadSavedApiKey: vi.fn(async () => null),
    regenerateManifest: vi.fn(),
    repairModelDownload: vi.fn(),
    setClarificationNeeded: vi.fn(),
    confirmAndContinue: vi.fn(),
  };
}

const flowState: ModelSelectionFlowState = { state: "unsupported" };

describe("StateView — unsupported (#766)", () => {
  it("renders both buttons and routes the clicks", () => {
    const actions = makeActions();
    render(
      <StateView
        flowState={flowState}
        actions={actions}
        onConfirmAndContinue={() => {}}
        onRetryFromError={() => {}}
      />,
    );

    const cloudButton = screen.getByText("Use a cloud model");
    const backButton = screen.getByText("Back to Description");

    fireEvent.click(cloudButton);
    assert.strictEqual(
      (actions.transitionTo as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0],
      "model_selection",
    );

    fireEvent.click(backButton);
    assert.strictEqual(
      (actions.transitionTo as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0],
      "idle",
    );

    cleanup();
  });
});
