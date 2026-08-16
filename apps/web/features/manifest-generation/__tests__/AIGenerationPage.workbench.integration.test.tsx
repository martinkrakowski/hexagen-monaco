// Plan Workbench C1 integration: the genesis AI flow (/projects/new/ai) mounts
// the SHARED PlanWorkbench two-pane shell with genesis-owned adapter props, and
// the composer routes through the SAME handleGenerate gate as before — the
// min-length validation, the explicit-local warning dialog and the /models
// detour are all preserved, and generation parks on the telemetry view with the
// shell footer's explicit actions (never an auto-navigation). Only the
// wire/port boundary is mocked (blueprint: plan-phase-form-seam.integration).

// crypto is a getter-only global in Node, so stub it via vi.stubGlobal (a plain
// `global.crypto =` throws "has only a getter"). Textual position is cosmetic:
// Vitest hoists imports, so emptyFormValues' module-eval id is minted by the
// REAL crypto.randomUUID before this line runs — the stub only makes the ids
// createDefaultProjectConfig mints at RUNTIME (one per genesis seed)
// deterministic, and no assertion reads either batch.
let uuidCounter = 0;
vi.stubGlobal("crypto", {
  randomUUID: () => `uuid-${(uuidCounter += 1)}`,
} as unknown as Crypto);

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  act,
} from "@testing-library/react";
import { deriveWorkspaceName } from "@hexagen/manifest-generation";
import { DESCRIPTION_MAX_LENGTH } from "@hexagen/agentic-interaction";
import type { ProjectSpec } from "@hexagen/project-configuration";

// The setup-file next/navigation stub mints a fresh router per call — this
// suite needs a STABLE push spy (the /models detour assertion) and a real
// ?name= query, so it overrides the mock with its own factory. searchParams
// is mutable so individual tests can enter with the bypassed-name (no
// ?name=) or regenerate (?generate=1) URLs; beforeEach restores the default.
const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  searchParams: new URLSearchParams("name=Vellum Notes"),
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
  useSearchParams: () => nav.searchParams,
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

// Passthrough shim over the REAL flow-state machine: every test runs the
// actual useModelSelectionFlowState (override null), but the non-idle
// flow-state test below needs an interstitial state (e.g. "error") that no
// in-page interaction can reach through this harness — the override forces
// the returned STATE only, leaving the machine and its actions real.
const flowStateOverride = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));
vi.mock(
  "../ModelSelectionFlow/useModelSelectionFlowState",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../ModelSelectionFlow/useModelSelectionFlowState")
      >();
    return {
      ...actual,
      useModelSelectionFlowState: (
        ...args: Parameters<typeof actual.useModelSelectionFlowState>
      ) => {
        const [state, actions] = actual.useModelSelectionFlowState(...args);
        return [
          (flowStateOverride.current as typeof state | null) ?? state,
          actions,
        ] as const;
      },
    };
  },
);

import { AIGenerationPage } from "../AIGenerationPage";
import { usePendingManifest } from "../store/usePendingManifest";
import { useExecutionEngine } from "../store/useExecutionEngine";
import {
  clearGenesisFormValues,
  loadGenesisFormValues,
} from "../genesis-workbench/genesisProjectSettingsStore";
import type { LocalLLMContext } from "../../../lib/llm-interfaces";
import { installResizeObserverStub } from "../../../__tests__/support/resize-observer-stub";

// jsdom has no <dialog>: the local-generation warning dialog calls showModal.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};

// The workbench's desktop layout is react-resizable-panels, which requires
// ResizeObserver (absent in jsdom).
installResizeObserverStub();

// Keep every network consumer quiet AND in-flight by default: the capability
// probe stays unresolved (irrelevant behind the server-key fast-pass) and the
// cloud staged generation never completes — exactly what the
// parked-on-telemetry assertions need (Cancel-only footer, no Next). The
// hand-off test overrides this per-URL (still the wire boundary: the staged
// NDJSON endpoint answers with a terminal "done" event); beforeEach restores
// the pending-forever default.
const pendingForever = () => new Promise<Response>(() => {});
const fetchMock = vi.fn<typeof fetch>(pendingForever);
vi.stubGlobal("fetch", fetchMock);

// The one per-test wire override: the staged NDJSON endpoint answers with a
// terminal "done" event so generation completes and parks. The manufactured
// system name ("test-system") doubles as the AI-derived workspace name the
// bypassed-name hand-off asserts on.
const STAGE_ENDPOINT = "/api/manifest/generate/stage";
const DONE_MANIFEST_YAML = [
  "system: test-system",
  'scope: "@hexagen/test"',
  'architecture: "modular-monolith"',
  "bounded_contexts:",
  '  - name: "UserContext"',
  '    type: "core"',
  '    description: "Handles user management"',
].join("\n");
const stageDoneEvent = `${JSON.stringify({
  type: "done",
  yaml: DONE_MANIFEST_YAML,
  contextCount: 1,
  portCount: 0,
  adapterCount: 0,
})}\n`;
const mockStageDone = () => {
  fetchMock.mockImplementation((input: RequestInfo | URL) =>
    String(input) === STAGE_ENDPOINT
      ? Promise.resolve(new Response(stageDoneEvent, { status: 200 }))
      : pendingForever(),
  );
};
/** fetch calls that hit the staged endpoint — the capability probe and other
 * consumers stay on the pending-forever default and must not count. */
const stageCalls = () =>
  fetchMock.mock.calls.filter(([input]) => String(input) === STAGE_ENDPOINT);

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
  nav.searchParams = new URLSearchParams("name=Vellum Notes");
  fetchMock.mockClear();
  fetchMock.mockImplementation(pendingForever);
  flowStateOverride.current = null;
});

describe("AIGenerationPage — Plan Workbench C1", () => {
  it("mounts the shared two-pane workbench: settings seeded from ?name=, genesis Section B without Add planning session, and the composer as the generate affordance", async () => {
    render(<AIGenerationPage llmContext={makeLlmContext()} />);

    // Left column: both shared accordion sections, open by default.
    assert.ok(screen.getByRole("button", { name: /project settings/i }));
    assert.ok(screen.getByRole("button", { name: /sessions & sources/i }));

    // Section A is the plan-phase field set, seeded from the carried name.
    const workspaceNameInput = screen.getByLabelText(
      "Workspace Name",
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

    // Caption row under the composer — the relocated DescriptionInput
    // affordances (disclosed deviation 2): the AI-ready indicator (server-key
    // fast-pass → ready) and the character counter at idle, announced via the
    // live region DescriptionInput's counter had (aria-live + aria-atomic).
    // Expected text mirrors the production toLocaleString formatting so the
    // pin is locale-independent.
    assert.ok(screen.getByText("AI Ready"));
    const counter = screen.getByText(
      `${(0).toLocaleString()} / ${DESCRIPTION_MAX_LENGTH.toLocaleString()}`,
    );
    const caption = counter.closest("p");
    assert.ok(caption, "counter renders inside the caption live region");
    assert.equal(caption.getAttribute("aria-live"), "polite");
    assert.equal(caption.getAttribute("aria-atomic"), "true");
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

    // The too-long arm of the same amber caption: over-limit copy replaces
    // the counter and the gate stays closed.
    fireEvent.change(composerTextarea(), {
      target: { value: "x".repeat(DESCRIPTION_MAX_LENGTH + 1) },
    });
    assert.ok(screen.getByText("Description exceeds character limit"));
    assert.equal(
      (screen.getByRole("button", { name: "Generate" }) as HTMLButtonElement)
        .disabled,
      true,
    );
    submitComposer();
    assert.equal(screen.queryByText("Generating Manifest"), null);
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

  it("parks on COMPLETION: the footer swaps Cancel for Go Back + Next, the success arm never auto-navigates, and the parked-run guard swallows late dependency changes", async () => {
    mockStageDone();
    render(<AIGenerationPage llmContext={makeLlmContext()} />);

    fireEvent.change(composerTextarea(), {
      target: { value: VALID_DESCRIPTION },
    });
    submitComposer();

    // The stream's terminal "done" event completes the run: the flow stays
    // parked on the telemetry view and the shell footer swaps Cancel for
    // Go Back plus the explicit Next.
    await waitFor(() =>
      assert.ok(screen.getByRole("button", { name: "Next" })),
    );
    assert.ok(screen.getByRole("button", { name: "Go Back" }));
    assert.equal(screen.queryByRole("button", { name: "Cancel" }), null);
    assert.ok(screen.getByText("Generating Manifest"));

    // Parked means parked: the success arm must NEVER router.push — the
    // hand-off to /ai/accept happens only through the footer's explicit
    // Next (the in-flight test above pins only the pre-completion half of
    // this contract).
    assert.equal(nav.push.mock.calls.length, 0);

    // Parked-run relaunch guard: a late dependency change re-runs the
    // generation effect over a COMPLETED run (engine toggle — auto and
    // cloud both resolve to the cloud path under the server-key fast-pass);
    // the hasResult guard must swallow it, not fire a second staged call.
    assert.equal(stageCalls().length, 1);
    await act(async () => {
      useExecutionEngine.setState({ engine: "cloud" });
    });
    assert.equal(stageCalls().length, 1);
    assert.equal(nav.push.mock.calls.length, 0);
  });

  it("renders the done event's Stage-6 findings on the parked view with the /spec flow's presentation (validation parity)", async () => {
    // The /stage route now attaches the Stage-6 report to its terminal done
    // event (previously dropped — plan §3.5); the parked telemetry view must
    // present it exactly like the /spec import flow: reviewer findings under
    // "optional improvements", auto-applied advisories bucketed as
    // adjustments (shared ValidationFindingsPanel).
    const doneWithValidation = `${JSON.stringify({
      type: "done",
      yaml: DONE_MANIFEST_YAML,
      contextCount: 1,
      portCount: 0,
      adapterCount: 0,
      validation: {
        errors: ["[R14] Port 'UserPort' does not reflect a use case."],
        warnings: [
          "Consider a query port for user reads.",
          // Auto-applied advisory signature (prefix + rule marker) — must be
          // bucketed as an adjustment, not a suggestion.
          "Auto-added a default repository port 'UserRepositoryPort' and adapter 'UserRepositoryAdapter' to context 'UserContext' — every context needs persistence (R03). Review and rename to fit your domain.",
        ],
        passed: false,
      },
    })}\n`;
    fetchMock.mockImplementation((input: RequestInfo | URL) =>
      String(input) === STAGE_ENDPOINT
        ? Promise.resolve(new Response(doneWithValidation, { status: 200 }))
        : pendingForever(),
    );
    render(<AIGenerationPage llmContext={makeLlmContext()} />);

    fireEvent.change(composerTextarea(), {
      target: { value: VALID_DESCRIPTION },
    });
    submitComposer();

    // Run completes and parks (footer Next present) — the findings panel
    // renders alongside the telemetry log.
    await waitFor(() =>
      assert.ok(screen.getByRole("button", { name: "Next" })),
    );
    // 1 error + 1 reviewer warning → "1 finding and 1 suggestion"; the R03
    // advisory is NOT counted here (it's an adjustment).
    assert.ok(
      screen.getByText(/1 finding and 1 suggestion from the review/, {
        exact: false,
      }),
    );
    assert.ok(
      screen.getByText(/1 adjustment was.*applied automatically/, {
        // summary text is broken across inline nodes
        exact: false,
      }),
    );
    // The adjustment notice's remedy must be route-appropriate: /stage has no
    // source spec to re-import, so the panel's /spec default may not leak in.
    assert.ok(screen.getByText(/adjust your prompt and generate again/i));
    assert.equal(screen.queryByText(/re-import/i), null);
    // Still parked — surfacing findings must not introduce auto-navigation.
    assert.equal(nav.push.mock.calls.length, 0);
  });

  it("the footer's Next hands the Stage-6 report to the pending-manifest store with the manifest (import round-trip integrity, Item 3.1)", async () => {
    // The accept screen keys its auto-fixer gate and approve logic on this
    // report; the prompt flow used to drop it at the hand-off even though the
    // stream parsed it.
    const report = {
      errors: [],
      warnings: ["Consider a query port for user reads."],
      passed: true,
    };
    const doneWithValidation = `${JSON.stringify({
      type: "done",
      yaml: DONE_MANIFEST_YAML,
      contextCount: 1,
      portCount: 0,
      adapterCount: 0,
      validation: report,
    })}\n`;
    fetchMock.mockImplementation((input: RequestInfo | URL) =>
      String(input) === STAGE_ENDPOINT
        ? Promise.resolve(new Response(doneWithValidation, { status: 200 }))
        : pendingForever(),
    );
    render(<AIGenerationPage llmContext={makeLlmContext()} />);

    fireEvent.change(composerTextarea(), {
      target: { value: VALID_DESCRIPTION },
    });
    submitComposer();

    const nextButton = await waitFor(() =>
      screen.getByRole("button", { name: "Next" }),
    );
    fireEvent.click(nextButton);

    assert.deepEqual(nav.push.mock.calls, [["/projects/new/ai/accept"]]);
    assert.deepEqual(usePendingManifest.getState().validationReport, report);
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
    // in the pre-workbench flow — except the detour now CARRIES ?name=:
    // ModelSelectionPage echoes it back on both return legs, so dropping it
    // here would reseed Section A from blank when the user returns.
    await waitFor(() =>
      assert.deepEqual(nav.push.mock.calls, [
        ["/projects/new/ai/models?name=Vellum%20Notes"],
      ]),
    );
    assert.equal(screen.queryByText("Generating Manifest"), null);
  });

  it("regenerate auto-start (?generate=1&name=) strips ONLY generate=1 — ?name= survives the router.replace so the store key and carried name stay intact", async () => {
    // The accept screen's Regenerate lands here with both params; the
    // auto-start effect fires once the description is valid again.
    nav.searchParams = new URLSearchParams("name=Vellum Notes&generate=1");
    render(<AIGenerationPage llmContext={makeLlmContext()} />);

    fireEvent.change(composerTextarea(), {
      target: { value: VALID_DESCRIPTION },
    });

    // engine "auto" + cloud available → auto-start straight to generating.
    await waitFor(() => assert.ok(screen.getByText("Generating Manifest")));
    // The URL cleanup consumed the auto-start intent but kept the name — a
    // parameterless replace here would flip carriedName to null mid-mount
    // and corrupt the genesis settings store key.
    assert.deepEqual(nav.replace.mock.calls, [
      ["/projects/new/ai?name=Vellum%20Notes"],
    ]);
  });

  it("bypassed-name flow: Section A edits survive the hand-off — handleUseManifest re-keys the null-keyed snapshot to the manufactured project name the accept screen will re-attach", async () => {
    // Direct visit: no ?name= (a supported entry — several in-app links push
    // /projects/new/ai bare), so Section A edits snapshot under the null key.
    nav.searchParams = new URLSearchParams("");
    // Terminal NDJSON "done" from the staged endpoint (the wire boundary):
    // generation completes and the footer's Next hands the manifest over.
    mockStageDone();

    render(<AIGenerationPage llmContext={makeLlmContext()} />);

    // Edit Section A while the flow has no carried name.
    const workspaceNameInput = screen.getByLabelText(
      "Workspace Name",
    ) as HTMLInputElement;
    fireEvent.change(workspaceNameInput, {
      target: { value: "vellum-edited" },
    });

    fireEvent.change(composerTextarea(), {
      target: { value: VALID_DESCRIPTION },
    });
    submitComposer();

    // Generation completes (the stream's done event) and parks on telemetry;
    // the footer's explicit Next performs the hand-off.
    const nextButton = await waitFor(() =>
      screen.getByRole("button", { name: "Next" }),
    );
    fireEvent.click(nextButton);

    // The manufactured name is the manifest's AI-derived workspace name.
    assert.equal(usePendingManifest.getState().projectName, "test-system");
    assert.deepEqual(nav.push.mock.calls, [["/projects/new/ai/accept"]]);
    // Back/Regenerate will re-attach ?name=test-system: the remounted page
    // must find the edits under that key, not reseed and wipe them.
    const rekeyed = loadGenesisFormValues("test-system");
    assert.ok(rekeyed, "snapshot re-keyed to the manufactured name");
    assert.equal(rekeyed.governance.workspaceName, "vellum-edited");
    assert.equal(loadGenesisFormValues(null), null);
  });

  it("drops the Section A snapshot on the footer's Back exit — an abandoned unnamed attempt must not seed the next bare visit", async () => {
    // Unnamed entry: the leak-prone case, since every unnamed flow shares
    // the null seed key and nothing else distinguishes a fresh visit from
    // an abandoned attempt in the same SPA session.
    nav.searchParams = new URLSearchParams("");
    render(<AIGenerationPage llmContext={makeLlmContext()} />);

    const workspaceNameInput = screen.getByLabelText(
      "Workspace Name",
    ) as HTMLInputElement;
    fireEvent.change(workspaceNameInput, {
      target: { value: "abandoned-edit" },
    });
    await waitFor(() =>
      assert.ok(loadGenesisFormValues(null), "edit mirrored into the store"),
    );

    // Back EXITS the flow (unlike the /models detour and the accept screen's
    // Back/Regenerate, which round-trip through the store) — the snapshot
    // must die with the flow.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    assert.deepEqual(nav.push.mock.calls, [["/projects/new"]]);
    assert.equal(loadGenesisFormValues(null), null);
  });

  it("gates Section B's Source row on origin: an import-flow leftover stays hidden, a genesis-origin spec renders its first-line excerpt", () => {
    // A pending manifest from the IMPORT flow (e.g. abandoned mid-accept) is
    // wrong-flow provenance — its spec text must not surface as a genesis
    // "Source". Only originPath "/projects/new/ai" feeds the row.
    usePendingManifest
      .getState()
      .set(
        "system: seeded",
        {} as unknown as ProjectSpec,
        "Seeded Project",
        "/projects/new/import/spec",
        "# Import spec leftover",
      );

    const { unmount } = render(
      <AIGenerationPage llmContext={makeLlmContext()} />,
    );
    assert.equal(screen.queryByText("Source"), null);
    assert.equal(screen.queryByText("# Import spec leftover"), null);
    unmount();

    // Same store, genesis origin: the row is wired and renders the spec's
    // first line only.
    usePendingManifest
      .getState()
      .set(
        "system: seeded",
        {} as unknown as ProjectSpec,
        "Seeded Project",
        "/projects/new/ai",
        "# Vellum spec\nsecond line is not excerpted",
      );

    render(<AIGenerationPage llmContext={makeLlmContext()} />);
    assert.ok(screen.getByText("Source"));
    assert.ok(screen.getByText("# Vellum spec"));
    assert.equal(screen.queryByText(/second line is not excerpted/), null);
  });
});

// Plan Workbench C2: the generation options leave the right-pane main body for
// a THIRD left-column accordion section, and the hand-off reconciles EDITED
// Section A identity into both the saved YAML and the wizardData (locked plan
// §5 Q5: edited > carriedName-derived > AI-derived).
describe("AIGenerationPage — Plan Workbench C2", () => {
  /** The relocated options section's accordion panel (Accordion.Content
   * renders role="region" named by its trigger). */
  const optionsRegion = () =>
    screen.getByRole("region", { name: "Generation options" });

  const workspaceNameInput = () =>
    screen.getByLabelText("Workspace Name") as HTMLInputElement;
  const namespacePrefixInput = () =>
    screen.getByLabelText("Namespace Prefix") as HTMLInputElement;

  /** Drive a full run to the parked telemetry view and click the footer's
   * explicit Next — the hand-off that fills usePendingManifest. Callers must
   * mockStageDone() first. */
  const generateAndHandOff = async () => {
    fireEvent.change(composerTextarea(), {
      target: { value: VALID_DESCRIPTION },
    });
    submitComposer();
    const nextButton = await waitFor(() =>
      screen.getByRole("button", { name: "Next" }),
    );
    fireEvent.click(nextButton);
  };

  it("relocates the generation options into a third left-column accordion section, below the two shared ones — and the example cards stay in the main body", () => {
    render(<AIGenerationPage llmContext={makeLlmContext()} />);

    // The section exists as an accordion trigger + open-by-default panel,
    // ORDERED after Project settings and Sessions & sources.
    const settings = screen.getByRole("button", { name: /project settings/i });
    const sessions = screen.getByRole("button", {
      name: /sessions & sources/i,
    });
    const options = screen.getByRole("button", { name: "Generation options" });
    assert.ok(
      settings.compareDocumentPosition(sessions) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    );
    assert.ok(
      sessions.compareDocumentPosition(options) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    );

    // Every relocated control lives INSIDE the panel — pinned in two halves:
    // the GLOBAL screen.getBy* queries throw on multiple matches, so a copy
    // left behind in the right-pane main body fails here (a within(region)
    // query would never see it), and region.contains pins the survivor to
    // the accordion panel.
    const region = optionsRegion();
    const deployment = screen.getByLabelText("Deployment (optional)");
    assert.ok(region.contains(deployment));
    const maxContexts = screen.getByLabelText("Max Bounded Contexts");
    assert.ok(region.contains(maxContexts));
    const engineGroup = screen.getByRole("radiogroup", {
      name: "Execution engine",
    });
    assert.ok(region.contains(engineGroup));
    const changeModel = screen.getByRole("button", { name: /change model/i });
    assert.ok(region.contains(changeModel));

    // §3.6 placement confirmation: the example cards STAY in the main view
    // body above the composer — not in the left column's new section.
    const quickExamples = screen.getByText("Quick Examples");
    assert.equal(region.contains(quickExamples), false);
    assert.ok(
      quickExamples.compareDocumentPosition(composerTextarea()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      "example cards render above the composer",
    );
  });

  it("keeps the relocated controls WIRED: the engine picker drives the store, Change Model detours through /models with ?name=, and the deployment value rides the staged request body", async () => {
    mockStageDone();
    render(<AIGenerationPage llmContext={makeLlmContext()} />);
    const region = optionsRegion();

    // Engine picker → useExecutionEngine (the same store the flow reads).
    fireEvent.click(within(region).getByRole("radio", { name: "Cloud" }));
    assert.equal(useExecutionEngine.getState().engine, "cloud");
    // Back to auto so the submit below takes the plain cloud fast-pass.
    fireEvent.click(within(region).getByRole("radio", { name: "Auto" }));
    assert.equal(useExecutionEngine.getState().engine, "auto");

    // onChangeModel → navigateToModelSelection(false): the /models detour,
    // still carrying ?name= (same contract as the explicit-local detour).
    fireEvent.click(
      within(region).getByRole("button", { name: /change model/i }),
    );
    assert.deepEqual(nav.push.mock.calls, [
      ["/projects/new/ai/models?name=Vellum%20Notes"],
    ]);
    nav.push.mockClear();

    // Deployment edit feeds handleGenerate's options — asserted at the wire:
    // the staged endpoint's JSON body carries the edited value.
    fireEvent.change(within(region).getByLabelText("Deployment (optional)"), {
      target: { value: "AWS Lambda" },
    });
    fireEvent.change(composerTextarea(), {
      target: { value: VALID_DESCRIPTION },
    });
    submitComposer();
    await waitFor(() => assert.equal(stageCalls().length, 1));
    const [, init] = stageCalls()[0];
    const body = JSON.parse(String((init as RequestInit).body));
    assert.equal(body.deployment, "AWS Lambda");
  });

  it("keeps the options section mounted but DISABLED while generating", async () => {
    // Default pending-forever fetch: the run stays in flight.
    render(<AIGenerationPage llmContext={makeLlmContext()} />);
    fireEvent.change(composerTextarea(), {
      target: { value: VALID_DESCRIPTION },
    });
    submitComposer();
    await waitFor(() => assert.ok(screen.getByText("Generating Manifest")));

    // The left column persists through the generating screen; its controls
    // must not accept edits that could desync from the in-flight request.
    const region = optionsRegion();
    const deployment = within(region).getByLabelText(
      "Deployment (optional)",
    ) as HTMLInputElement;
    assert.equal(deployment.disabled, true);
    const maxContexts = within(region).getByLabelText(
      "Max Bounded Contexts",
    ) as HTMLInputElement;
    assert.equal(maxContexts.disabled, true);
    for (const radio of within(region).getAllByRole("radio")) {
      assert.equal((radio as HTMLButtonElement).disabled, true);
    }
    assert.equal(
      (
        within(region).getByRole("button", {
          name: /change model/i,
        }) as HTMLButtonElement
      ).disabled,
      true,
    );
  });

  it("identity reconciliation (locked §5 Q5): EDITED Section A identity wins over the carried name — saved YAML system/scope and wizardData agree, formValues-only fields never invent YAML", async () => {
    mockStageDone();
    render(<AIGenerationPage llmContext={makeLlmContext()} />);

    // Edit both identity fields plus a formValues-only field in Section A.
    fireEvent.change(workspaceNameInput(), {
      target: { value: "vellum-edited" },
    });
    fireEvent.change(namespacePrefixInput(), {
      target: { value: "@vellum-scope" },
    });
    fireEvent.change(screen.getByLabelText("Package Manager"), {
      target: { value: "pnpm" },
    });

    await generateAndHandOff();

    const state = usePendingManifest.getState();
    // The saved manifest string and the wizardData MUST agree on identity —
    // the edits, not the carried name's derivation or the AI's test-system.
    assert.match(state.yaml as string, /^system: vellum-edited$/m);
    assert.match(state.yaml as string, /^scope: ['"]?@vellum-scope['"]?$/m);
    assert.equal(state.formValues?.governance?.workspaceName, "vellum-edited");
    assert.equal(
      state.formValues?.governance?.namespacePrefix,
      "@vellum-scope",
    );
    // packageManager has NO YAML home (locked §5 Q5): the edit rides
    // wizardData into the save, and no governance section is invented.
    assert.equal(state.formValues?.governance?.packageManager, "pnpm");
    assert.doesNotMatch(state.yaml as string, /governance:|packageManager/);
    // The carried name still names the PROJECT — identity edits do not
    // rename it.
    assert.equal(state.projectName, "Vellum Notes");
    assert.deepEqual(nav.push.mock.calls, [["/projects/new/ai/accept"]]);
  });

  it("per-field precedence: the edited identity field wins while the untouched one falls back to the carried name's derivation", async () => {
    mockStageDone();
    render(<AIGenerationPage llmContext={makeLlmContext()} />);

    // Only workspaceName is edited; namespacePrefix keeps its seed value.
    fireEvent.change(workspaceNameInput(), {
      target: { value: "vellum-edited" },
    });

    await generateAndHandOff();

    const state = usePendingManifest.getState();
    const slug = deriveWorkspaceName("Vellum Notes").name;
    assert.match(state.yaml as string, /^system: vellum-edited$/m);
    assert.match(
      state.yaml as string,
      new RegExp(`^scope: ['"]?@${slug}['"]?$`, "m"),
    );
    assert.equal(state.formValues?.governance?.namespacePrefix, `@${slug}`);
  });

  it("bypassed-name guard: an unrelated Section A edit must NOT let untouched seed identity defaults clobber the AI-derived system/scope", async () => {
    // No ?name=: the seed's identity defaults (emptyFormValues' "@hexagen")
    // were never typed by the user. Editing ONLY packageManager creates the
    // snapshot — a whole-object "snapshot exists → its values win" would now
    // stamp "@hexagen" over the AI's test-system.
    nav.searchParams = new URLSearchParams("");
    mockStageDone();
    render(<AIGenerationPage llmContext={makeLlmContext()} />);

    fireEvent.change(screen.getByLabelText("Package Manager"), {
      target: { value: "pnpm" },
    });

    await generateAndHandOff();

    const state = usePendingManifest.getState();
    // Identity stays AI-derived, in YAML and wizardData alike.
    assert.match(state.yaml as string, /^system: test-system$/m);
    assert.match(state.yaml as string, /^scope: ['"]?@hexagen\/test['"]?$/m);
    assert.equal(state.formValues?.governance?.workspaceName, "test-system");
    // The edit the user DID make still lands.
    assert.equal(state.formValues?.governance?.packageManager, "pnpm");
    assert.equal(state.projectName, "test-system");
  });

  it("carried-name tier in isolation: with Section A untouched, the hand-off derives system/scope from ?name= (the default flow's pre-C2 contract)", async () => {
    // No Section A edits at all — no snapshot, so `edited` is empty and the
    // precedence chain's MIDDLE tier must carry alone: dropping the
    // carriedSlug fallback (or the whole identity-rewrite block) would leave
    // the AI's test-system in the saved YAML.
    mockStageDone();
    render(<AIGenerationPage llmContext={makeLlmContext()} />);

    await generateAndHandOff();

    const state = usePendingManifest.getState();
    const slug = deriveWorkspaceName("Vellum Notes").name;
    assert.match(state.yaml as string, new RegExp(`^system: ${slug}$`, "m"));
    assert.match(
      state.yaml as string,
      new RegExp(`^scope: ['"]?@${slug}['"]?$`, "m"),
    );
    assert.equal(state.formValues?.governance?.workspaceName, slug);
    assert.equal(state.formValues?.governance?.namespacePrefix, `@${slug}`);
    assert.equal(state.projectName, "Vellum Notes");
  });

  it("bypassed-flow round trip: after the rekey, a second hand-off under the re-attached ?name= still reports only the real edit — untouched @hexagen seed defaults never clobber system/scope", async () => {
    // Pass 1 — bypassed entry, edit ONLY packageManager (identity untouched:
    // the null seed's "@hexagen" defaults). This is one step PAST the
    // bypassed-name guard test above: the hand-off rekeys the snapshot to
    // the manufactured "test-system".
    nav.searchParams = new URLSearchParams("");
    mockStageDone();
    const { unmount } = render(
      <AIGenerationPage llmContext={makeLlmContext()} />,
    );

    fireEvent.change(screen.getByLabelText("Package Manager"), {
      target: { value: "pnpm" },
    });
    await generateAndHandOff();
    assert.match(
      usePendingManifest.getState().yaml as string,
      /^system: test-system$/m,
    );

    // Accept-screen Back: clears the pending manifest and re-attaches the
    // manufactured name as ?name=test-system; the page remounts.
    unmount();
    usePendingManifest.getState().clear();
    nav.push.mockClear();
    nav.searchParams = new URLSearchParams("name=test-system");

    // Pass 2 — regenerate and hand off again. The diff baseline must still
    // be the NULL seed the flow started from: a baseline recomputed from the
    // "test-system" key would report the untouched "@hexagen" identity
    // defaults as edits and stamp them over system/scope.
    render(<AIGenerationPage llmContext={makeLlmContext()} />);
    await generateAndHandOff();

    const state = usePendingManifest.getState();
    const slug = deriveWorkspaceName("test-system").name;
    assert.match(state.yaml as string, new RegExp(`^system: ${slug}$`, "m"));
    assert.match(
      state.yaml as string,
      new RegExp(`^scope: ['"]?@${slug}['"]?$`, "m"),
    );
    assert.doesNotMatch(state.yaml as string, /^system: @hexagen$/m);
    assert.equal(state.formValues?.governance?.workspaceName, slug);
    assert.equal(state.formValues?.governance?.namespacePrefix, `@${slug}`);
    // The one REAL edit still rides the second hand-off too.
    assert.equal(state.formValues?.governance?.packageManager, "pnpm");
    assert.equal(state.projectName, "test-system");
  });

  it("non-idle flow states drop the generationOptions slot: the interstitial fills the main view with NO Generation options section and no composer", () => {
    // No in-page interaction reaches the StateView interstitials through
    // this harness (the closest paths stay idle), so force the machine's
    // returned state via the passthrough shim — the slots contract under
    // test (types.ts: generationOptions "absent in non-idle flow states")
    // belongs to GenerateWithAi's rendering, not to how the state was
    // reached.
    flowStateOverride.current = {
      state: "error",
      error: "engine exploded",
      errorCode: null,
      isModelReady: false,
    };
    render(<AIGenerationPage llmContext={makeLlmContext()} />);

    // The interstitial is the main view…
    assert.ok(screen.getByText("engine exploded"));
    // …and the left column's third section is NOT rendered alongside it,
    // nor is the composer.
    assert.equal(
      screen.queryByRole("button", { name: "Generation options" }),
      null,
    );
    assert.equal(screen.queryByLabelText("Project description"), null);
  });
});
