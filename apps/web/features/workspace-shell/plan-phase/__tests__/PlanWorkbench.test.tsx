// The A2 state-lift proof: these tests run the REAL usePlanningSession under
// the REAL PlanPhaseView wiring host (only the wizard-lifecycle context and the
// chat-stream wire are mocked), because the property under test — finalize
// progress SURVIVING a right-pane view switch — is exactly what component-local
// state could not provide.

vi.stubGlobal("crypto", {
  randomUUID: () => `uuid-${(uuidCounter += 1)}`,
} as unknown as Crypto);

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import {
  render as rtlRender,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";

let uuidCounter = 0;

const lifecycle = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));
vi.mock("../../contexts/WizardLifecycleContext", () => ({
  useWizardLifecycleContext: () => lifecycle.current,
}));

// Mock ONLY the wire boundary: every model turn (loop AND distill) is one
// streamChatTurn call, scripted in order.
type StreamResult =
  | { ok: true; content: string }
  | { ok: false; error: string; aborted: boolean };
const stream = vi.hoisted(() => ({
  scripts: [] as Array<StreamResult | "hang">,
  calls: [] as Array<{ message: string; signal?: AbortSignal }>,
}));
vi.mock("../session/stream-chat-turn", () => ({
  streamChatTurn: async (opts: {
    message: string;
    signal?: AbortSignal;
  }): Promise<StreamResult> => {
    stream.calls.push({ message: opts.message, signal: opts.signal });
    const script = stream.scripts.shift();
    if (!script) throw new Error("Unscripted streamChatTurn call");
    if (script === "hang") {
      // Match the REAL streamChatTurn contract: it never rejects — an abort
      // resolves { ok: false, aborted: true }.
      return new Promise((resolve) => {
        opts.signal?.addEventListener("abort", () =>
          resolve({ ok: false, error: "Aborted", aborted: true }),
        );
      });
    }
    return script;
  },
}));

// Since PR B, row selection is URL-driven (`?layer=` via router.replace), so
// the view-switch round-trips here need the STATEFUL next/navigation stub —
// under the inert global stub from vitest.setup.ts the replace would be
// swallowed and the main view would never switch. (Factory referenced lazily;
// vi.mock is hoisted above the import.)
vi.mock("next/navigation", async () =>
  (await import("./nav-stub")).statefulNavigationMock(),
);

import { navState } from "./nav-stub";
import { PlanPhaseView } from "../PlanPhaseView";
import { emptyFormValues } from "../../../project-wizard/config";
import { installResizeObserverStub } from "../../../../__tests__/support/resize-observer-stub";

function PlanFormHarness({ children }: { children: React.ReactNode }) {
  const form = useForm({ defaultValues: emptyFormValues });
  return <FormProvider {...form}>{children}</FormProvider>;
}
const render = (ui: React.ReactElement) =>
  rtlRender(ui, { wrapper: PlanFormHarness });

HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};

// Desktop workbench = react-resizable-panels = ResizeObserver (absent in jsdom).
installResizeObserverStub();

const DEFAULT_WIDTH = 1024;
function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

const bodyText = () => (document.body.textContent || "").replace(/\s+/g, " ");

function button(label: RegExp): HTMLButtonElement {
  const btn = Array.from(document.querySelectorAll("button")).find((b) =>
    label.test(b.textContent || ""),
  );
  assert.ok(btn, `expected a button matching ${label}`);
  return btn as HTMLButtonElement;
}

function sessionRow(title: RegExp): HTMLButtonElement {
  const nav = document.querySelector('nav[aria-label="Sessions and sources"]');
  assert.ok(nav, "the sessions nav is present");
  const row = Array.from(nav.querySelectorAll("button")).find((b) =>
    title.test(b.textContent || ""),
  );
  assert.ok(row, `expected a sessions row matching ${title}`);
  return row as HTMLButtonElement;
}

const CONVERGED_CRITIQUE = "Looks solid.\nVERDICT: CONVERGED";

// In-memory committed-turn counter for the appendLayerTurn contract (the hook
// mirrors the COMMITTED turn storage returned).
let turnCounter = 0;

beforeEach(() => {
  cleanup();
  navState.reset();
  setViewportWidth(DEFAULT_WIDTH);
  stream.scripts = [];
  stream.calls = [];
  turnCounter = 0;
  lifecycle.current = {
    loadedProject: {
      id: "p1",
      name: "Vellum",
      schemaVersion: 4,
      createdAt: 0,
      updatedAt: 0,
      formState: {},
      manifestYaml: "",
      layers: [
        {
          id: "L-arch",
          kind: "brainstorm",
          title: "Archived notes",
          createdAt: 5,
          updatedAt: 5,
          turns: [{ id: "a1", author: "You", content: "archived content" }],
        },
      ],
    },
    addLayer: vi.fn(async () => "layer-live"),
    updateLayer: vi.fn(async () => true),
    appendLayerTurn: vi.fn(
      async (
        _projectId: string,
        _layerId: string,
        turn: { author: string; content: string },
      ) => ({ ...turn, id: `turn-${(turnCounter += 1)}`, at: turnCounter }),
    ),
    removeLayer: vi.fn(async () => true),
    updateProjectFormState: vi.fn(),
    layersPersistError: null,
    clearLayersPersistError: vi.fn(),
  };
});

/** Drives the REAL hook from seed to a converged session via the composer. */
async function startAndConverge() {
  stream.scripts.push(
    { ok: true, content: "Proposal v1" },
    { ok: true, content: CONVERGED_CRITIQUE },
  );
  const textarea = document.querySelector(
    'textarea[aria-label="Session brief"]',
  ) as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: "Build a todo app" } });
  fireEvent.click(button(/Start session/));
  await waitFor(() =>
    assert.ok(
      button(/Finalize → Generate manifest/),
      "convergence surfaces the shell-footer Finalize",
    ),
  );
}

describe("PlanWorkbench (real hook through the wiring host)", () => {
  it("retains finalize review text and phase when the main view switches away and back mid-finalize", async () => {
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);
    await startAndConverge();

    // Finalize: beginFinalize persists "finalizing", then the distill streams.
    stream.scripts.push({
      ok: true,
      content: "```yaml\nname: distilled-app\ncontexts: []\n```",
    });
    fireEvent.click(button(/Finalize → Generate manifest/));
    await waitFor(() =>
      assert.ok(document.querySelector('[data-testid="finalize-review"]')),
    );
    const review = document.querySelector(
      'textarea[aria-label="Distilled spec"]',
    ) as HTMLTextAreaElement;
    assert.equal(review.value, "name: distilled-app\ncontexts: []");

    // Edit the review, then switch the main view AWAY (unmounts the live view).
    fireEvent.change(review, {
      target: { value: "name: edited-by-human\ncontexts: []" },
    });
    fireEvent.click(sessionRow(/Archived notes/));
    assert.equal(
      document.querySelector('[data-testid="finalize-review"]'),
      null,
      "the live view (and its review panel) unmounted",
    );
    assert.match(bodyText(), /archived content/);

    // ...and back. The lifted state restores the review EXACTLY.
    fireEvent.click(sessionRow(/Live session/));
    const restored = document.querySelector(
      'textarea[aria-label="Distilled spec"]',
    ) as HTMLTextAreaElement;
    assert.ok(restored, "the review phase survived the view switch");
    assert.equal(
      restored.value,
      "name: edited-by-human\ncontexts: []",
      "the edited text survived the view switch",
    );
    // No cancelFinalize fired: the layer was never reverted to "converged".
    const updateLayer = lifecycle.current.updateLayer as ReturnType<
      typeof vi.fn
    >;
    const statusWrites = updateLayer.mock.calls.map(
      (c) => (c[2] as { status?: string }).status,
    );
    assert.ok(statusWrites.includes("finalizing"));
    assert.ok(
      !statusWrites.includes("converged"),
      "no cancelFinalize during the round-trip",
    );
  });

  it("keeps an in-flight DISTILL streaming across a view switch (abort only on host unmount)", async () => {
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);
    await startAndConverge();

    stream.scripts.push("hang");
    fireEvent.click(button(/Finalize → Generate manifest/));
    await waitFor(() =>
      assert.ok(document.querySelector('[data-testid="finalize-distilling"]')),
    );
    const distillCall = stream.calls[2];
    assert.ok(distillCall.signal, "the distill carries an abort signal");
    assert.equal(distillCall.signal.aborted, false);

    // A view switch must NOT abort the distill — the hook lives in the host.
    fireEvent.click(sessionRow(/Archived notes/));
    assert.equal(distillCall.signal.aborted, false, "stream survives switch");
    fireEvent.click(sessionRow(/Live session/));
    assert.ok(
      document.querySelector('[data-testid="finalize-distilling"]'),
      "still distilling after the round-trip",
    );
  });

  it("live row shows the session status chip and the active layer never lists as archived", async () => {
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);
    await startAndConverge();

    const chip = document.querySelector(
      '[data-testid="session-row-status-chip"]',
    );
    assert.equal(chip?.textContent, "Converged");
    const nav = document.querySelector(
      'nav[aria-label="Sessions and sources"]',
    );
    assert.doesNotMatch(
      nav?.textContent ?? "",
      /Build a todo app/,
      "the live layer is not an archived row",
    );
  });

  it("renders NO Generation options section — the C2 slot is genesis-only and this host omits it", () => {
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);

    // Plan Workbench C2 added an OPTIONAL third accordion section for the
    // genesis host's generation options; the plan-phase host must stay at
    // exactly the two shared sections (zero behavior change for
    // /projects/[id]).
    assert.ok(button(/Project settings/));
    assert.ok(button(/Sessions & sources/));
    assert.doesNotMatch(bodyText(), /Generation options/);
  });
});

describe("PlanWorkbench (mobile, locked §5 Q6)", () => {
  beforeEach(() => setViewportWidth(500));

  it("tabs Plan | Session, with Add planning session pinned BELOW both tabs", () => {
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);

    // Plan tab first: settings + sessions sections are on screen.
    assert.ok(
      document.querySelector('button[aria-label="Plan"]'),
      "Plan tab present",
    );
    assert.ok(
      document.querySelector('button[aria-label="Session"]'),
      "Session tab present",
    );
    assert.match(bodyText(), /Project settings/);
    assert.ok(button(/Add planning session/), "footer action on the Plan tab");
    assert.doesNotMatch(bodyText(), /Start a live session/);

    // Switch to the Session tab: the live view + composer replace the form,
    // and the footer action MUST remain reachable (it sits below the tabs).
    fireEvent.click(
      document.querySelector('button[aria-label="Session"]') as HTMLElement,
    );
    assert.match(bodyText(), /Start a live session/);
    assert.ok(
      document.querySelector('textarea[aria-label="Session brief"]'),
      "seed composer on the Session tab",
    );
    assert.ok(
      button(/Add planning session/),
      "footer action still visible on the Session tab (below both tabs)",
    );

    // And it still works from there.
    fireEvent.click(button(/Add planning session/));
    assert.ok(
      document.querySelector(
        'textarea[aria-label="Session transcript (markdown)"]',
      ),
      "the add-session dialog opens from the Session tab",
    );
  });
});
