import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Violation, AISuggestion } from "@hexagen/prompt-compiler";
import type { LocalLifecycle } from "../GovernanceAssistantPanel/lifecycle";
import {
  GovernanceQaView,
  type GovernanceQaViewProps,
} from "../GovernanceAssistantPanel/view/GovernanceQaView";
import {
  LocalModeView,
  type LocalModeViewProps,
} from "../GovernanceAssistantPanel/view/LocalModeView";

/**
 * See the note in `governance-capability-probe.test.tsx`: `yarn.lock` gives
 * `packages/model-settings` its own React instance, so none of its hooks can
 * run inside an `apps/web` render. It is a collaborator of the views under
 * test, never the subject.
 */
vi.mock("@hexagen/model-settings", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useHardwareDetection: () => ({ profile: null, isDetecting: false }),
  ModelSettingsView: (props: Record<string, unknown>) => (
    <div data-testid="model-settings-view">
      chat:{String(props.serverModelName)}|generation:
      {String(props.generationModelName)}|warn:
      {String(props.requiresModelWarning)}
    </div>
  ),
}));

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Any call to the network fails this suite: these views own no transport. */
function forbidNetwork() {
  const spy = vi.fn(() =>
    Promise.reject(new Error("a governance view must not reach the network")),
  );
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

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

function qaProps(
  overrides: Partial<GovernanceQaViewProps> = {},
): GovernanceQaViewProps {
  return {
    currentStepIndex: 0,
    violations: [violation],
    suggestions: [suggestion],
    activeItem: null,
    onSelectViolation: () => {},
    onSelectSuggestion: () => {},
    displayQuestions: [
      { id: "q-1", type: "step", label: "What does this step decide?" },
    ],
    isStreaming: false,
    isExpanded: () => false,
    onQuestionClick: () => {},
    conversationThread: [],
    lastAssistantMessage: "",
    regeneratingEntryId: null,
    onRegenerate: () => {},
    followUpQuestions: [],
    onFollowUpClick: () => {},
    threadLoaded: true,
    footerModelId: null,
    footerModelLabel: "z-ai/glm-5.2",
    footerIsLoading: false,
    onOpenSettings: () => {},
    ...overrides,
  };
}

function localProps(
  lifecycle: LocalLifecycle,
  overrides: Partial<LocalModeViewProps> = {},
): LocalModeViewProps {
  return {
    lifecycle,
    isLoading: false,
    capabilities: {},
    loadedModel: null,
    loadedModelId: null,
    messagesLength: 0,
    onCancelDownload: () => {},
    onOpenSettings: () => {},
    onInitModel: () => {},
    onBackFromSettings: () => {},
    onSwitchToCloud: () => {},
    onSwitchModel: async () => {},
    onDeleteModel: async () => {},
    hasModelInCache: async () => false,
    onResetConfig: () => {},
    serverAssistantAvailable: false,
    ...overrides,
  };
}

describe("GovernanceQaView — Q&A renders from props alone (REA-001)", () => {
  it("renders governance findings and questions with no context provider and no network", () => {
    const fetchSpy = forbidNetwork();

    // No LocalLLMProvider, no SecretVaultProvider, no wizardData: before the
    // boundary split this component could not be constructed without all three,
    // because the same function that rendered the Q&A also owned the engine
    // subscription, the cloud transport and the capability probe.
    render(<GovernanceQaView {...qaProps()} />);

    expect(screen.getByText(violation.message)).toBeTruthy();
    expect(screen.getByText(suggestion.message)).toBeTruthy();
    expect(screen.getByText("What does this step decide?")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("raises the settings intent instead of switching the view itself", () => {
    forbidNetwork();
    const onOpenSettings = vi.fn();

    render(<GovernanceQaView {...qaProps({ onOpenSettings })} />);
    screen.getByTitle(/click to manage model/i).click();

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("keeps the route into model settings when no model name is known", () => {
    // The state a server-assistant deployment is in for as long as the
    // capability probe is in flight — and permanently if it fails: no local
    // model loaded, so `footerModelId` is null, and no confirmed server name,
    // so `footerModelLabel` is undefined. The footer previously papered over
    // this by asserting a hard-coded "gpt-4o-mini"; not asserting a name must
    // not cost the user the only way out of the Q&A view.
    forbidNetwork();
    const onOpenSettings = vi.fn();

    render(
      <GovernanceQaView
        {...qaProps({
          footerModelId: null,
          footerModelLabel: undefined,
          onOpenSettings,
        })}
      />,
    );

    const settings = screen.getByRole("button", { name: /manage models/i });
    settings.click();

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    // …and it still names no model it has not been told about.
    expect(screen.queryByText(/gpt-4o-mini/i)).toBeNull();
  });
});

describe("LocalModeView — one discriminant selects one card (REA-002)", () => {
  // The population is the whole `LocalLifecycle` union: every kind, with the
  // marker that proves the right card rendered. A kind added to the union and
  // not handled by the view is a compile error inside the view's `never` arm;
  // a kind added here without a case fails this table.
  const cases: ReadonlyArray<{
    lifecycle: LocalLifecycle;
    marker: RegExp;
  }> = [
    { lifecycle: { kind: "booting" }, marker: /^$/ },
    {
      lifecycle: { kind: "unsupported", reason: "no_webgpu" },
      marker: /WebGPU Not Available/,
    },
    {
      lifecycle: { kind: "unsupported", reason: "unsupported_browser" },
      marker: /Browser Not Supported/,
    },
    { lifecycle: { kind: "waking-up" }, marker: /Waking up Local AI/ },
    {
      lifecycle: { kind: "loading", status: "downloading", progress: 0.5 },
      marker: /Loading Model/,
    },
    { lifecycle: { kind: "failed", message: "boom" }, marker: /Engine Error/ },
    { lifecycle: { kind: "requires-model" }, marker: /warn:true/ },
    { lifecycle: { kind: "usable" }, marker: /warn:false/ },
  ];

  it("covers every lifecycle kind", () => {
    // Anti-vacuity for the table below.
    const kinds = new Set(cases.map((c) => c.lifecycle.kind));
    expect([...kinds].sort()).toEqual(
      [
        "booting",
        "failed",
        "loading",
        "requires-model",
        "unsupported",
        "usable",
        "waking-up",
      ].sort(),
    );
  });

  for (const { lifecycle, marker } of cases) {
    const name =
      lifecycle.kind === "unsupported"
        ? `${lifecycle.kind}:${lifecycle.reason}`
        : lifecycle.kind;

    it(`renders the ${name} card and nothing else`, () => {
      forbidNetwork();
      const { container } = render(
        <LocalModeView {...localProps(lifecycle)} />,
      );

      if (marker.source === "^$") {
        // The boot spinner has no text; assert it is the spinner, not a card.
        expect(container.querySelector(".animate-spin")).toBeTruthy();
        expect(container.textContent).toBe("");
      } else {
        expect(container.textContent).toMatch(marker);
      }
    });
  }

  it("takes the unsupported reason from the variant instead of casting the engine status", () => {
    forbidNetwork();
    // Before the discriminant this branch read `llmEngineState.status as
    // "no_webgpu" | "unsupported_browser"` — a cast that was correct only
    // because a boolean computed elsewhere happened to agree with it.
    const { container } = render(
      <LocalModeView
        {...localProps({ kind: "unsupported", reason: "unsupported_browser" })}
      />,
    );
    expect(container.textContent).toMatch(/Browser Not Supported/);
    expect(container.textContent).not.toMatch(/WebGPU Not Available/);
  });

  it("shows the capability names it is given, and probes for none of its own", () => {
    const fetchSpy = forbidNetwork();

    render(
      <LocalModeView
        {...localProps(
          { kind: "usable" },
          {
            capabilities: {
              chatModelName: "z-ai/glm-5.2",
              generationModelName: "inception/mercury-2",
            },
          },
        )}
      />,
    );

    const card = screen.getByTestId("model-settings-view");
    expect(card.textContent).toContain("chat:z-ai/glm-5.2");
    expect(card.textContent).toContain("generation:inception/mercury-2");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
