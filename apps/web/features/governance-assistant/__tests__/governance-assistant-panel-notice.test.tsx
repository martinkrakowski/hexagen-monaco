import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Violation, AISuggestion } from "@hexagen/prompt-compiler";

/**
 * See the note in `governance-capability-probe.test.tsx`: `yarn.lock` gives
 * `packages/model-settings` its own React instance, so none of its hooks can
 * run inside an `apps/web` render. It is a collaborator of the views under
 * test, never the subject.
 */
vi.mock("@hexagen/model-settings", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useHardwareDetection: () => ({ profile: null, isDetecting: false }),
  ModelSettingsView: () => <div data-testid="model-settings-view" />,
}));

vi.mock("@/lib/local-llm-context", () => ({
  useLocalLLMConfig: () => ({
    engineState: {
      status: "ready",
      loadedModelId: null,
      autoLoading: false,
      progress: 0,
      errorMessage: null,
    },
    loadedModel: null,
    initializeModel: vi.fn(),
    cancelDownload: vi.fn(),
    enterRequiresModel: vi.fn(),
    clearError: vi.fn(),
    switchModel: vi.fn(),
    deleteCachedModel: vi.fn(),
    hasModelInCache: vi.fn(),
    hasAnyCachedModel: vi.fn(),
    returnToModelSettings: vi.fn(),
    resetLocalAIConfig: vi.fn(),
  }),
  useLocalLLMStreaming: () => ({
    messages: [],
    isStreaming: false,
    sendMessage: vi.fn(),
    sendGovernanceMessage: vi.fn(),
    sendStructuredPrompt: vi.fn(),
  }),
}));

vi.mock("@/lib/vault-context", () => ({
  useSecretVault: () => ({}),
  SecretVaultProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/lib/wire", () => ({
  getChatPersistence: () => ({}),
  hasServerLLMAccessKey: () => true,
}));

// The offer is controlled per-test via this hoisted mock function.
const offerMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/local-llm/useStoredChatHistoryOffer", () => ({
  useStoredChatHistoryOffer: () => offerMock(),
}));

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const wizardData = {
  governance: { workspaceName: "test-ws" },
  boundedContexts: [],
  externalContexts: [],
  peerMappings: [],
  addOnsAnswers: {},
};

const violation: Violation = {
  id: "v-1",
  type: "error",
  message: "Context 'billing' has no inbound port",
  severity: "HIGH",
};

const suggestion: AISuggestion = {
  id: "s-1",
  message: "Split 'billing' into payments and invoicing",
  confidence: 0.8,
  category: "context-split",
};

import { GovernanceAssistantPanel } from "../GovernanceAssistantPanel/GovernanceAssistantPanel";

describe("GovernanceAssistantPanel — stored chat history notice", () => {
  it("does not render the notice when the offer is null", async () => {
    offerMock.mockReturnValue(null);

    const { container } = render(
      <GovernanceAssistantPanel
        wizardData={wizardData}
        currentStepIndex={0}
        violations={[violation]}
        suggestions={[suggestion]}
        onRefresh={() => {}}
        isLoading={false}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(container.textContent).not.toContain("Stored assistant messages");
  });

  it("renders the notice when the offer is non-null", async () => {
    offerMock.mockReturnValue({
      count: 3,
      error: false,
      download: vi.fn(),
      discard: vi.fn(),
    });

    const { container } = render(
      <GovernanceAssistantPanel
        wizardData={wizardData}
        currentStepIndex={0}
        violations={[violation]}
        suggestions={[suggestion]}
        onRefresh={() => {}}
        isLoading={false}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(container.textContent).toContain("Stored assistant messages");
    expect(container.textContent).toContain(
      "This browser holds 3 assistant messages",
    );
    expect(screen.getByText("Download")).toBeTruthy();
    expect(screen.getByText("Discard")).toBeTruthy();
  });
});
