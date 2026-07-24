// Plan Workbench C1 integration: the genesis AI flow (/projects/new/ai) mounts
// the SHARED PlanWorkbench two-pane shell with genesis-owned adapter props, and
// the composer routes through the SAME handleGenerate gate as before — the
// min-length validation, the explicit-local warning dialog and the /models
// detour are all preserved, and generation parks on the telemetry view with the
// shell footer's explicit actions (never an auto-navigation). Only the
// wire/port boundary is mocked (blueprint: plan-phase-form-seam.integration).

// crypto is a getter-only global in Node, so stub it via vi.stubGlobal (a plain
// `global.crypto =` throws "has only a getter") — and BEFORE the imports below:
// emptyFormValues seeds a bounded-context id via crypto.randomUUID at module
// eval, and createBlankProjectConfig mints one per genesis seed.
let uuidCounter = 0;
vi.stubGlobal("crypto", {
  randomUUID: () => `uuid-${(uuidCounter += 1)}`,
} as unknown as Crypto);

import { describe, it, vi, beforeEach, beforeAll, afterAll } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { deriveWorkspaceName } from "@hexagen/manifest-generation";

// The setup-file next/navigation stub mints a fresh router per call — this
// suite needs a STABLE push spy (the /models detour assertion) and a real
// ?name= query, so it overrides the mock with its own factory.
const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: nav.push,
    replace: nav.replace,
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/projects/new/ai",
  useSearchParams: () => new URLSearchParams("name=Vellum Notes"),
  useParams: () => ({}),
}));

// The ONLY wire mock: cloud readiness. hasServerLLMAccessKey → true is the
// readiness fast-pass (isProbing false, hasAnyCloud true, needsSetup false),
// i.e. the deployed server-key configuration. Everything above it —
// useLLMReadiness, useExecutionEngine, the flow-state machine, the staged
// generation hook — stays real.
vi.mock("../../../app/lib/wire.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../app/lib/wire.client")>()),
  hasServerLLMAccessKey: vi.fn(() => true),
  isLocalLLMReady: vi.fn(() => false),
}));

import { AIGenerationPage } from "../AIGenerationPage";
import { usePendingManifest } from "../store/usePendingManifest";
import { useExecutionEngine } from "../store/useExecutionEngine";
import { clearGenesisFormValues } from "../genesis-workbench/genesisProjectSettingsStore";
import type { LocalLLMContext } from "../../../lib/llm-interfaces";

// jsdom has no <dialog>: the local-generation warning dialog calls showModal.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};

// The workbench's desktop layout is react-resizable-panels, which requires
// ResizeObserver (absent in jsdom).
const hadResizeObserver = "ResizeObserver" in globalThis;
const originalResizeObserver = globalThis.ResizeObserver;
beforeAll(() => {
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});
afterAll(() => {
  if (hadResizeObserver) {
    globalThis.ResizeObserver = originalResizeObserver;
  } else {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  }
});

// Keep every network consumer quiet AND in-flight: the capability probe stays
// unresolved (irrelevant behind the server-key fast-pass) and the cloud staged
// generation never completes — exactly what the parked-on-telemetry assertions
// need (Cancel-only footer, no Next).
vi.stubGlobal(
  "fetch",
  vi.fn(() => new Promise<Response>(() => {})),
);

/** Idle local engine: nothing downloaded, nothing loaded — the WebLLM detour
 * case. Only the members the genesis flow actually reads are functional. */
const makeLlmContext = (): LocalLLMContext =>
  ({
    engineState: { status: "unloaded" },
    initializeModel: vi.fn(async () => {}),
    cancelDownload: vi.fn(),
    hasAnyCachedModel: vi.fn(async () => false),
    hasModelInCache: vi.fn(async () => false),
    switchModel: vi.fn(async () => {}),
    deleteCachedModel: vi.fn(async () => {}),
    loadedModel: null,
    sendGovernanceMessage: vi.fn(async () => {}),
    sendStructuredPrompt: vi.fn(async () => ""),
    messages: [],
  }) as unknown as LocalLLMContext;

const VALID_DESCRIPTION =
  "A task management system with boards and realtime collaboration.";

const composerTextarea = () =>
  screen.getByLabelText("Project description") as HTMLTextAreaElement;

/** Submit the composer form directly: deterministic in jsdom (a click on the
 * submit button would rely on jsdom's implicit form submission). */
const submitComposer = () => {
  fireEvent.submit(composerTextarea().closest("form") as HTMLFormElement);
};

beforeEach(() => {
  // Module-scoped genesis stores would otherwise bleed between tests.
  clearGenesisFormValues();
  usePendingManifest.getState().clear();
  useExecutionEngine.setState({ engine: "auto" });
  nav.push.mockClear();
  nav.replace.mockClear();
});

describe("AIGenerationPage — Plan Workbench C1", () => {
  it("mounts the shared two-pane workbench: settings seeded from ?name=, genesis Section B without Add planning session, and the composer as the generate affordance", async () => {
    render(<AIGenerationPage llmContext={makeLlmContext()} />);

    // Left column: both shared accordion sections, open by default.
    assert.ok(screen.getByRole("button", { name: /project settings/i }));
    assert.ok(screen.getByRole("button", { name: /sessions & sources/i }));

    // Section A is the plan-phase field set, seeded from the carried name.
    const workspaceNameInput = document.querySelector(
      'input[placeholder="@mycompany"]',
    ) as HTMLInputElement;
    assert.ok(workspaceNameInput, "genesis settings form renders");
    assert.equal(
      workspaceNameInput.value,
      deriveWorkspaceName("Vellum Notes").name,
    );

    // Section B: genesis empty state with the EXACT plan-phase copy; the
    // "Add planning session" footer is hidden entirely (locked §5 Q1).
    assert.ok(screen.getByText("Draft brief"));
    assert.ok(
      screen.getByText("Planning sessions are available after you save"),
    );
    assert.equal(screen.queryByText("Add planning session"), null);

    // Right pane: form-era content plus the bottom composer (which replaces
    // DescriptionInput and the ActionBar as the single submit affordance).
    assert.ok(screen.getByText("Project with AI"));
    assert.ok(composerTextarea());
    assert.ok(screen.getByRole("button", { name: "Generate" }));
    assert.equal(screen.queryByText("Generating Manifest"), null);
  });

  it("keeps the min-length gate: a too-short description disables Generate, shows the amber caption, and a forced submit does not start generation", () => {
    render(<AIGenerationPage llmContext={makeLlmContext()} />);

    fireEvent.change(composerTextarea(), { target: { value: "too short" } });

    const generateButton = screen.getByRole("button", {
      name: "Generate",
    }) as HTMLButtonElement;
    assert.equal(generateButton.disabled, true);
    assert.ok(screen.getByText("Description must be at least 10 characters."));

    // Even a direct form submit must be swallowed by the composer's disabled
    // gate — the flow may not leave the form.
    submitComposer();
    assert.equal(screen.queryByText("Generating Manifest"), null);
    assert.equal(composerTextarea().value, "too short");
  });

  it("routes a valid description through handleGenerate to the parked telemetry view — Cancel-only footer, and NO auto-navigation", async () => {
    render(<AIGenerationPage llmContext={makeLlmContext()} />);

    fireEvent.change(composerTextarea(), {
      target: { value: VALID_DESCRIPTION },
    });
    const generateButton = screen.getByRole("button", {
      name: "Generate",
    }) as HTMLButtonElement;
    assert.equal(generateButton.disabled, false);

    submitComposer();

    // engine "auto" + cloud available → straight to the generating view: the
    // telemetry step becomes the workbench's MAIN view.
    await waitFor(() => assert.ok(screen.getByText("Generating Manifest")));
    // The composer leaves with the form — the run is not re-submittable.
    assert.equal(screen.queryByLabelText("Project description"), null);

    // In flight (the fetch never resolves): the shell footer offers Cancel
    // only. On success the flow PARKS here behind an explicit Next — so
    // there must never be a router.push out of this screen.
    assert.ok(screen.getByRole("button", { name: "Cancel" }));
    assert.equal(screen.queryByRole("button", { name: "Next" }), null);
    assert.equal(nav.push.mock.calls.length, 0);
  });

  it("preserves the explicit-local path: warning dialog first, then Continue detours through /models when no model is ready or remembered", async () => {
    useExecutionEngine.setState({ engine: "local" });
    render(<AIGenerationPage llmContext={makeLlmContext()} />);

    fireEvent.change(composerTextarea(), {
      target: { value: VALID_DESCRIPTION },
    });
    submitComposer();

    // The Dialog mounts its children only while open, so this text appearing
    // IS the dialog-opened assertion. getByText (not getByRole): jsdom's a11y
    // tree excludes the native <dialog> subtree.
    await waitFor(() =>
      assert.ok(screen.getByText("Generate with local model?")),
    );
    // Gated: no generation started yet.
    assert.equal(screen.queryByText("Generating Manifest"), null);

    fireEvent.click(screen.getByText("Continue with local"));

    // Engine unloaded + no remembered model → the /models detour, exactly as
    // in the pre-workbench flow.
    await waitFor(() =>
      assert.deepEqual(nav.push.mock.calls, [["/projects/new/ai/models"]]),
    );
    assert.equal(screen.queryByText("Generating Manifest"), null);
  });
});
