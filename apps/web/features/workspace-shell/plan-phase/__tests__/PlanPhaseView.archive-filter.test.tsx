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
import { emptyFormValues } from "../../../project-wizard/config";

// Separate file from PlanPhaseView.test.tsx: this one mocks usePlanningSession
// itself (module-level vi.mock) to pin the archive-filter, view-union and
// composer-mode seams, while the main suite exercises the view with the REAL
// hook.
const lifecycle = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));
vi.mock("../../contexts/WizardLifecycleContext", () => ({
  useWizardLifecycleContext: () => lifecycle.current,
}));

const planningSession = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));
vi.mock("../session/usePlanningSession", () => ({
  usePlanningSession: () => planningSession.current,
}));

// Selection lives in the `?layer=` URL param (PR B): replace the inert global
// next/navigation stub with the stateful one, so a row click — which only
// calls router.replace — actually re-renders the view, and deep links can be
// seeded via navState.reset("layer=…").
vi.mock("next/navigation", async () =>
  (await import("./nav-stub")).statefulNavigationMock(),
);
import { navState } from "./nav-stub";

import { PlanPhaseView } from "../PlanPhaseView";
import { installResizeObserverStub } from "../../../../__tests__/support/resize-observer-stub";

// PlanPhaseView renders ProjectSettingsSection, whose fields read the shared
// wizard form via `useFormContext`; wrap every render in a FormProvider harness
// (production uses WizardStepFormProvider) by shadowing `render`.
function PlanFormHarness({ children }: { children: React.ReactNode }) {
  const form = useForm({ defaultValues: emptyFormValues });
  return <FormProvider {...form}>{children}</FormProvider>;
}
const render = (ui: React.ReactElement) =>
  rtlRender(ui, { wrapper: PlanFormHarness });

// jsdom has no <dialog>; PlanPhaseView mounts (closed) dialogs.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};

// The desktop workbench renders react-resizable-panels → needs ResizeObserver.
installResizeObserverStub();

const bodyText = () => (document.body.textContent || "").replace(/\s+/g, " ");

function sessionRow(title: RegExp): HTMLButtonElement {
  const nav = document.querySelector('nav[aria-label="Sessions and sources"]');
  assert.ok(nav, "the sessions nav is present");
  const row = Array.from(nav.querySelectorAll("button")).find((b) =>
    title.test(b.textContent || ""),
  );
  assert.ok(row, `expected a sessions row matching ${title}`);
  return row as HTMLButtonElement;
}

function button(label: RegExp): HTMLButtonElement {
  const btn = Array.from(document.querySelectorAll("button")).find((b) =>
    label.test(b.textContent || ""),
  );
  assert.ok(btn, `expected a button matching ${label}`);
  return btn as HTMLButtonElement;
}

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionState: null,
    activeLayerId: null,
    draft: null,
    isRunning: false,
    seed: "",
    turns: [],
    start: vi.fn(async () => true),
    attach: vi.fn(),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    addSteering: vi.fn(async () => true),
    forceConverge: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
    beginFinalize: vi.fn(async () => {}),
    cancelFinalize: vi.fn(async () => {}),
    finalize: { phase: "idle" },
    startFinalize: vi.fn(async () => {}),
    abandonFinalize: vi.fn(async () => {}),
    setFinalizeReviewText: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  };
}

const layer = (id: string, title: string) => ({
  id,
  kind: "brainstorm",
  title,
  createdAt: 1,
  updatedAt: 1,
  turns: [{ id: `${id}-t1`, author: "You", content: `${title} content` }],
});

beforeEach(() => {
  cleanup();
  navState.reset();
  lifecycle.current = {
    loadedProject: {
      id: "p1",
      name: "Vellum",
      schemaVersion: 4,
      createdAt: 0,
      updatedAt: 0,
      formState: {},
      manifestYaml: "",
      layers: [layer("L-active", "Live one"), layer("L-old", "Archived one")],
    },
    addLayer: vi.fn(async () => "layer-id"),
    updateLayer: vi.fn(async () => true),
    appendLayerTurn: vi.fn(async () => ({
      id: "turn-id",
      author: "AI",
      content: "",
      at: 0,
    })),
    removeLayer: vi.fn(async () => true),
    updateProjectFormState: vi.fn(),
    layersPersistError: null,
    clearLayersPersistError: vi.fn(),
  };
  planningSession.current = makeSession();
});

describe("PlanPhaseView archive filter (single hook instance)", () => {
  it("filters the ACTIVE session's layer out of the sessions list (its turns render once, in the live view)", () => {
    planningSession.current = makeSession({
      activeLayerId: "L-active",
      sessionState: {
        status: "critiquing",
        round: 1,
        maxRounds: 4,
        nextRole: "critic",
      },
      turns: [{ id: "t", author: "You", content: "live turn", role: "human" }],
    });
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);

    const nav = document.querySelector(
      'nav[aria-label="Sessions and sources"]',
    );
    assert.ok(nav);
    assert.match(
      nav.textContent || "",
      /Archived one/,
      "non-active layer stays listed",
    );
    assert.doesNotMatch(
      nav.textContent || "",
      /Live one/,
      "the active layer never appears as an archived row",
    );
    assert.match(bodyText(), /live turn/, "the live view renders the session");
    // The pinned live row carries the session's status chip.
    const chip = document.querySelector(
      '[data-testid="session-row-status-chip"]',
    );
    assert.equal(chip?.textContent, "Critiquing");
  });

  it("lists ALL layers when no session is active (live row has no status chip)", () => {
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);
    const nav = document.querySelector(
      'nav[aria-label="Sessions and sources"]',
    );
    assert.ok(nav);
    assert.match(nav.textContent || "", /Live one/);
    assert.match(nav.textContent || "", /Archived one/);
    assert.equal(
      document.querySelector('[data-testid="session-row-status-chip"]'),
      null,
    );
  });
});

describe("PlanPhaseView view union (right-pane selection)", () => {
  it("switches between an archived reader and the live view via row selection", () => {
    planningSession.current = makeSession({
      activeLayerId: "L-active",
      sessionState: {
        status: "critiquing",
        round: 1,
        maxRounds: 4,
        nextRole: "critic",
      },
      turns: [{ id: "t", author: "You", content: "live turn", role: "human" }],
    });
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);

    // Only the archived row is selectable; open it, then confirm the live row
    // brings the live view back.
    fireEvent.click(sessionRow(/Archived one/));
    assert.match(bodyText(), /Archived one content/);
    assert.doesNotMatch(bodyText(), /live turn/);

    fireEvent.click(sessionRow(/Live session/));
    assert.match(bodyText(), /live turn/);
    assert.doesNotMatch(bodyText(), /Archived one content/);
  });

  it("normalizes a selected layer that becomes the ACTIVE session's layer back to the live view", () => {
    // Row selection alone can't produce this state (the active layer is
    // filtered out of the rows), so drive it through the mocked hook: select
    // the archived layer, THEN rerender with the session attached to that
    // very layer — attach() to an interrupted layer and PR B's ?layer= URLs
    // both reach this. The view union must resolve the id to the live view;
    // the layer's turns must never render twice.
    planningSession.current = makeSession({
      activeLayerId: "L-active",
      sessionState: {
        status: "critiquing",
        round: 1,
        maxRounds: 4,
        nextRole: "critic",
      },
      turns: [{ id: "t", author: "You", content: "live turn", role: "human" }],
    });
    const { rerender } = render(<PlanPhaseView onNavigateToImport={vi.fn()} />);

    fireEvent.click(sessionRow(/Archived one/));
    assert.match(bodyText(), /Archived one content/);
    assert.doesNotMatch(bodyText(), /live turn/);

    planningSession.current = makeSession({
      activeLayerId: "L-old",
      sessionState: {
        status: "critiquing",
        round: 1,
        maxRounds: 4,
        nextRole: "critic",
      },
      turns: [{ id: "t", author: "You", content: "live turn", role: "human" }],
    });
    rerender(<PlanPhaseView onNavigateToImport={vi.fn()} />);
    assert.match(
      bodyText(),
      /live turn/,
      "the selected-now-active id resolves to the live view",
    );
    assert.doesNotMatch(
      bodyText(),
      /Archived one content/,
      "the now-active layer's transcript never renders twice",
    );
  });

  it("falls back to the live view when the selected layer no longer exists in the project", () => {
    // The on-screen delete confirm resets mainView explicitly, so this guard
    // only fires when the layer vanishes some other way (a write from
    // another tab rehydrating the project, PR B's ?layer= URLs). An unknown
    // id must fall back to the live view — including the composer, which
    // gates on resolvedView (not on which pane component rendered).
    planningSession.current = makeSession();
    const { rerender } = render(<PlanPhaseView onNavigateToImport={vi.fn()} />);

    fireEvent.click(sessionRow(/Archived one/));
    assert.match(bodyText(), /Archived one content/);

    lifecycle.current = {
      ...lifecycle.current,
      loadedProject: {
        ...(lifecycle.current.loadedProject as Record<string, unknown>),
        layers: [layer("L-active", "Live one")],
      },
    };
    rerender(<PlanPhaseView onNavigateToImport={vi.fn()} />);
    assert.doesNotMatch(bodyText(), /Archived one content/);
    assert.match(
      bodyText(),
      /Start a live session/,
      "unknown id falls back to the live view",
    );
    assert.ok(
      document.querySelector('textarea[aria-label="Session brief"]'),
      "the composer follows the NORMALIZED view, not the raw selection",
    );
  });

  it("hides Delete for the reader of a non-archived (active) layer by never offering the active layer as a row", () => {
    planningSession.current = makeSession({
      activeLayerId: "L-active",
      sessionState: {
        status: "critiquing",
        round: 1,
        maxRounds: 4,
        nextRole: "critic",
      },
    });
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);
    // The live view never renders the reader's Delete affordance.
    assert.equal(
      document.querySelector('button[aria-label="Delete session"]'),
      null,
    );
  });
});

describe("PlanPhaseView ?layer= deep-linking (PR B)", () => {
  it("selects an archived layer via router.REPLACE, preserving unrelated params — and never push", () => {
    navState.reset("project=p1&phase=plan");
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);

    fireEvent.click(sessionRow(/Archived one/));
    assert.match(bodyText(), /Archived one content/);
    assert.match(navState.search, /layer=L-old/);
    assert.match(navState.search, /project=p1/);
    assert.match(navState.search, /phase=plan/, "unrelated params preserved");

    // Selecting live CLEARS the param (live = the param's absence).
    fireEvent.click(sessionRow(/Live session/));
    assert.doesNotMatch(navState.search, /layer=/);
    assert.match(navState.search, /project=p1/);
    assert.match(navState.search, /phase=plan/);

    assert.equal(
      navState.pushCalls.length,
      0,
      "selection never pushes — no history spam",
    );
    assert.equal(navState.replaceCalls.length, 2);
  });

  it("opens the layer view from a deep link with ?layer=<archived-id>", () => {
    navState.reset("layer=L-old");
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);

    assert.ok(
      document.querySelector(
        'section[aria-label="Planning session: Archived one"]',
      ),
      "the deep-linked layer's reader is the initial view",
    );
    assert.match(bodyText(), /Archived one content/);
    assert.equal(
      navState.replaceCalls.length,
      0,
      "a valid deep link is left alone",
    );
  });

  it("falls back to live for ?layer=<unknown id> and CLEANS the param via replace", async () => {
    navState.reset("project=p1&layer=ghost");
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);

    assert.match(
      bodyText(),
      /Start a live session/,
      "unknown id falls back to the live view",
    );
    await waitFor(() => assert.doesNotMatch(navState.search, /layer=/));
    assert.match(navState.search, /project=p1/, "other params survive");
    assert.equal(navState.pushCalls.length, 0);
  });

  it("normalizes ?layer=<the ACTIVE session's layer id> to live, cleans the param, and never offers Delete (guard)", async () => {
    planningSession.current = makeSession({
      activeLayerId: "L-active",
      sessionState: {
        status: "critiquing",
        round: 1,
        maxRounds: 4,
        nextRole: "critic",
      },
      turns: [{ id: "t", author: "You", content: "live turn", role: "human" }],
    });
    navState.reset("layer=L-active");
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);

    assert.match(
      bodyText(),
      /live turn/,
      "the session-backed layer resolves to the LIVE view, not a reader",
    );
    assert.doesNotMatch(
      bodyText(),
      /Live one content/,
      "the active layer's transcript never renders twice",
    );
    // The delete guard survives URL-driven selection: the reader (the only
    // place with a Delete affordance) is unreachable for the active layer.
    assert.equal(
      document.querySelector('button[aria-label="Delete session"]'),
      null,
    );
    await waitFor(() => assert.doesNotMatch(navState.search, /layer=/));
  });

  it("falls back to live and cleans the param when the deep-linked layer is REALLY removed from the project", async () => {
    // Exercises the resolvedView normalization for real (the A2 review found
    // the delete-path test's mock never shrank loadedProject.layers): the id
    // enters via the URL, the reader opens, THEN the layer genuinely
    // disappears from the loaded project — as an external write (another
    // tab) or a delete would cause.
    navState.reset("layer=L-old");
    const { rerender } = render(<PlanPhaseView onNavigateToImport={vi.fn()} />);
    assert.match(bodyText(), /Archived one content/);

    lifecycle.current = {
      ...lifecycle.current,
      loadedProject: {
        ...(lifecycle.current.loadedProject as Record<string, unknown>),
        layers: [layer("L-active", "Live one")],
      },
    };
    rerender(<PlanPhaseView onNavigateToImport={vi.fn()} />);

    assert.doesNotMatch(bodyText(), /Archived one content/);
    assert.match(
      bodyText(),
      /Start a live session/,
      "the dead id falls back to the live view",
    );
    await waitFor(() => assert.doesNotMatch(navState.search, /layer=/));
    assert.equal(navState.pushCalls.length, 0);
  });

  it("keeps the add-session view OUT of the URL: transient overlay over the deep-linked view, restored on leave", () => {
    navState.reset("layer=L-old");
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);
    assert.match(bodyText(), /Archived one content/);

    const footerAdd = Array.from(document.querySelectorAll("button")).find(
      (b) => /Add planning session/.test(b.textContent || ""),
    ) as HTMLButtonElement;
    fireEvent.click(footerAdd);

    const addView = document.querySelector(
      'section[aria-label="Add planning session"]',
    );
    assert.ok(addView, "the add-session view replaced the reader");
    assert.equal(
      navState.search,
      "layer=L-old",
      "the overlay is NEVER persisted to the URL",
    );
    assert.equal(navState.replaceCalls.length, 0);

    const cancel = Array.from(addView.querySelectorAll("button")).find((b) =>
      /Cancel/.test(b.textContent || ""),
    ) as HTMLButtonElement;
    fireEvent.click(cancel);
    assert.match(
      bodyText(),
      /Archived one content/,
      "leaving the overlay restores the URL-derived view",
    );
  });
});

describe("PlanPhaseView add-session overlay row-click exits (B review round)", () => {
  // The overlay comment names THREE exit paths — Cancel, row click, success.
  // Cancel and success are pinned above/in the main suite; these pin the
  // row-click one (both selectors), which also carries the submitFailed
  // reset: only closeAddSession reset it before, so a failed submit's alert
  // leaked into the NEXT view instance over freshly reopened fields.

  it("a sessions-row click drops the overlay and clears a failed submit's error for the next open", async () => {
    lifecycle.current.addLayer = vi.fn(async () => null); // the write fails
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);

    fireEvent.click(button(/Add planning session/));
    fireEvent.change(
      document.querySelector(
        'textarea[aria-label="Session transcript (markdown)"]',
      ) as HTMLTextAreaElement,
      { target: { value: "will fail" } },
    );
    fireEvent.click(button(/Add session/));
    await waitFor(() =>
      assert.ok(
        document.querySelector('[role="alert"]'),
        "the failed submit surfaces its inline error",
      ),
    );

    fireEvent.click(sessionRow(/Archived one/));
    assert.equal(
      document.querySelector('section[aria-label="Add planning session"]'),
      null,
      "the row click drops the overlay",
    );
    assert.match(bodyText(), /Archived one content/, "the reader is forward");

    fireEvent.click(button(/Add planning session/));
    assert.equal(
      document.querySelector('[role="alert"]'),
      null,
      "no stale submit error on the next open, before any submit",
    );
  });

  it("the pinned Live row also exits the overlay, restoring the live view and clearing ?layer=", () => {
    navState.reset("layer=L-old");
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);
    assert.match(bodyText(), /Archived one content/);

    fireEvent.click(button(/Add planning session/));
    assert.ok(
      document.querySelector('section[aria-label="Add planning session"]'),
    );

    fireEvent.click(sessionRow(/Live session/));
    assert.equal(
      document.querySelector('section[aria-label="Add planning session"]'),
      null,
      "the Live row click drops the overlay",
    );
    assert.match(bodyText(), /Start a live session/);
    assert.doesNotMatch(navState.search, /layer=/);
    assert.equal(navState.pushCalls.length, 0);
  });
});

describe("PlanPhaseView composer modes", () => {
  it("live view + no session: seed mode — submit calls start() with the brief", async () => {
    const session = makeSession();
    planningSession.current = session;
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);

    const textarea = document.querySelector(
      'textarea[aria-label="Session brief"]',
    ) as HTMLTextAreaElement;
    assert.ok(textarea, "seed composer present");
    assert.match(
      bodyText(),
      /Each round uses 2 AI chat requests from your daily quota\./,
      "ADR-0045 Q5 quota caption",
    );
    fireEvent.change(textarea, { target: { value: "Build a todo app" } });
    fireEvent.click(
      Array.from(document.querySelectorAll("button")).find((b) =>
        /Start session/.test(b.textContent || ""),
      ) as HTMLButtonElement,
    );
    await waitFor(() =>
      assert.deepEqual((session.start as ReturnType<typeof vi.fn>).mock.calls, [
        ["Build a todo app"],
      ]),
    );
    // Accepted submit clears the draft.
    await waitFor(() => assert.equal(textarea.value, ""));
  });

  it("a failed start surfaces an inline error and keeps the typed brief", async () => {
    const session = makeSession({ start: vi.fn(async () => false) });
    planningSession.current = session;
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);

    const textarea = document.querySelector(
      'textarea[aria-label="Session brief"]',
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Build a todo app" } });
    fireEvent.click(
      Array.from(document.querySelectorAll("button")).find((b) =>
        /Start session/.test(b.textContent || ""),
      ) as HTMLButtonElement,
    );

    await waitFor(() => {
      const alert = document.querySelector('[role="alert"]');
      assert.match(alert?.textContent ?? "", /Couldn't start the session/);
    });
    // The brief the user typed is NOT discarded on failure.
    assert.equal(textarea.value, "Build a todo app");
  });

  it("live view + active session: steering mode — submit calls addSteering()", async () => {
    const session = makeSession({
      activeLayerId: "L-active",
      sessionState: {
        status: "awaiting-human",
        round: 2,
        maxRounds: 4,
        awaitReason: "paused",
        resumeStatus: "proposing",
      },
    });
    planningSession.current = session;
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);

    const textarea = document.querySelector(
      'textarea[aria-label="Steering note"]',
    ) as HTMLTextAreaElement;
    assert.ok(textarea, "steering composer present");
    assert.match(
      bodyText(),
      /Each round uses 2 AI chat requests from your daily quota\./,
      "quota caption in steering mode too",
    );
    fireEvent.change(textarea, { target: { value: "focus on billing" } });
    fireEvent.click(
      Array.from(document.querySelectorAll("button")).find(
        (b) => (b.textContent || "").trim() === "Send",
      ) as HTMLButtonElement,
    );
    await waitFor(() =>
      assert.deepEqual(
        (session.addSteering as ReturnType<typeof vi.fn>).mock.calls,
        [["focus on billing"]],
      ),
    );
    // A durably persisted steering turn clears the draft.
    await waitFor(() => assert.equal(textarea.value, ""));
  });

  it("keeps the steering draft when the persist fails (addSteering resolves false)", async () => {
    const session = makeSession({
      activeLayerId: "L-active",
      sessionState: {
        status: "awaiting-human",
        round: 2,
        maxRounds: 4,
        awaitReason: "paused",
        resumeStatus: "proposing",
      },
      addSteering: vi.fn(async () => false),
    });
    planningSession.current = session;
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);

    const textarea = document.querySelector(
      'textarea[aria-label="Steering note"]',
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "focus on billing" } });
    fireEvent.click(
      Array.from(document.querySelectorAll("button")).find(
        (b) => (b.textContent || "").trim() === "Send",
      ) as HTMLButtonElement,
    );
    await waitFor(() =>
      assert.deepEqual(
        (session.addSteering as ReturnType<typeof vi.fn>).mock.calls,
        [["focus on billing"]],
      ),
    );
    // The failed persist must NOT silently discard the typed note — the
    // composer keeps it for retry (same protection the seed branch has).
    assert.equal(textarea.value, "focus on billing");
  });

  it("keeps the steering composer available WHILE the loop is running, not only while parked", () => {
    // Steering is first-class at ANY point — a mid-run note folds into the
    // NEXT model turn (fold.ts), it does not wait for awaiting-human. This
    // pin lived in the LiveSessionSection suite before the composer moved to
    // the host; it must survive the move.
    planningSession.current = makeSession({
      activeLayerId: "L-active",
      isRunning: true,
      sessionState: {
        status: "critiquing",
        round: 1,
        maxRounds: 4,
        nextRole: "critic",
      },
    });
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);
    assert.ok(
      document.querySelector('textarea[aria-label="Steering note"]'),
      "steering input available while running",
    );
  });

  it("layer view: the composer is hidden; the typed draft survives the view round-trip", () => {
    planningSession.current = makeSession();
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);

    const textarea = document.querySelector(
      'textarea[aria-label="Session brief"]',
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "half-typed brief" } });

    fireEvent.click(sessionRow(/Archived one/));
    assert.equal(
      document.querySelector('textarea[aria-label="Session brief"]'),
      null,
      "no composer on a read-only transcript (§5 Q3)",
    );

    fireEvent.click(sessionRow(/Live session/));
    const back = document.querySelector(
      'textarea[aria-label="Session brief"]',
    ) as HTMLTextAreaElement;
    assert.equal(
      back.value,
      "half-typed brief",
      "the draft is lifted to the host and survives the unmount",
    );
  });

  it("done session: composer hidden (no steering into a terminal session)", () => {
    planningSession.current = makeSession({
      activeLayerId: "L-active",
      sessionState: { status: "done", round: 2, maxRounds: 4 },
    });
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);
    assert.equal(
      document.querySelector('textarea[aria-label="Session brief"]'),
      null,
    );
    assert.equal(
      document.querySelector('textarea[aria-label="Steering note"]'),
      null,
    );
  });

  it("converged/finalizing session: composer hidden (steering has no consumer — D4 soft gate)", () => {
    // A note typed here would provably never be read: steering only folds
    // into the NEXT model turn, and none runs after convergence (fold.ts /
    // distill.ts / canConsumeSteering). Hidden, not disabled, mirroring done.
    for (const status of ["converged", "finalizing"] as const) {
      cleanup();
      planningSession.current = makeSession({
        activeLayerId: "L-active",
        sessionState: { status, round: 2, maxRounds: 4 },
      });
      render(<PlanPhaseView onNavigateToImport={vi.fn()} />);
      assert.equal(
        document.querySelector('textarea[aria-label="Session brief"]'),
        null,
        `no seed composer at ${status}`,
      );
      assert.equal(
        document.querySelector('textarea[aria-label="Steering note"]'),
        null,
        `no steering composer at ${status}`,
      );
    }
  });
});

describe("PlanPhaseView shell footer (locked §5 Q2)", () => {
  it("is empty until converged; when converged it offers Finalize wired to the lifted startFinalize", async () => {
    const session = makeSession({
      activeLayerId: "L-active",
      sessionState: {
        status: "awaiting-human",
        round: 2,
        maxRounds: 4,
        awaitReason: "paused",
        resumeStatus: "proposing",
      },
    });
    planningSession.current = session;
    const { unmount } = render(<PlanPhaseView onNavigateToImport={vi.fn()} />);
    assert.equal(
      Array.from(document.querySelectorAll("button")).find((b) =>
        /Finalize → Generate manifest/.test(b.textContent || ""),
      ),
      undefined,
      "no footer action before convergence",
    );
    unmount();

    const converged = makeSession({
      activeLayerId: "L-active",
      sessionState: { status: "converged", round: 2, maxRounds: 4 },
    });
    planningSession.current = converged;
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);
    const finalizeButton = Array.from(document.querySelectorAll("button")).find(
      (b) => /Finalize → Generate manifest/.test(b.textContent || ""),
    ) as HTMLButtonElement;
    assert.ok(finalizeButton, "converged surfaces the footer action");
    fireEvent.click(finalizeButton);
    await waitFor(() =>
      assert.equal(
        (converged.startFinalize as ReturnType<typeof vi.fn>).mock.calls.length,
        1,
      ),
    );
  });

  it("offers Finalize again after a failed distillation (converged + finalize error)", async () => {
    // §5 Q2's error half: a failed distill leaves finalize.phase at "error"
    // (only attach/end/reset clear it), and the in-pane alert's "you can
    // retry" copy points at the SHELL FOOTER button — the only retry
    // affordance on screen. It must render and re-fire startFinalize.
    const errored = makeSession({
      activeLayerId: "L-active",
      sessionState: { status: "converged", round: 2, maxRounds: 4 },
      finalize: { phase: "error", message: "model unavailable" },
    });
    planningSession.current = errored;
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);
    const retryButton = Array.from(document.querySelectorAll("button")).find(
      (b) => /Finalize → Generate manifest/.test(b.textContent || ""),
    ) as HTMLButtonElement;
    assert.ok(
      retryButton,
      "Finalize is offered again after a failed distillation",
    );
    fireEvent.click(retryButton);
    await waitFor(() =>
      assert.equal(
        (errored.startFinalize as ReturnType<typeof vi.fn>).mock.calls.length,
        1,
      ),
    );
  });

  it("Finalize fired from a READER view brings the live view forward and clears ?layer= (replace, never push)", async () => {
    // handleFinalize deliberately calls selectLive() before startFinalize():
    // the distill streams into the LIVE view's panels and must be on-screen.
    // Since PR B that switch is URL-backed, so it must also clear the
    // now-dead ?layer= param — every other footer test fires Finalize from
    // the default live view, where selectLive() is a no-op.
    const converged = makeSession({
      activeLayerId: "L-active",
      sessionState: { status: "converged", round: 2, maxRounds: 4 },
      turns: [{ id: "t", author: "You", content: "live turn", role: "human" }],
    });
    planningSession.current = converged;
    navState.reset("layer=L-old");
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);
    assert.match(
      bodyText(),
      /Archived one content/,
      "a reader view is on-screen when Finalize is clicked",
    );

    fireEvent.click(button(/Finalize → Generate manifest/));
    assert.match(bodyText(), /live turn/, "the live view came forward");
    assert.doesNotMatch(
      bodyText(),
      /Archived one content/,
      "the reader is gone — the distill will not stream off-screen",
    );
    await waitFor(() => assert.doesNotMatch(navState.search, /layer=/));
    assert.equal(navState.pushCalls.length, 0, "cleared via replace only");
    await waitFor(() =>
      assert.equal(
        (converged.startFinalize as ReturnType<typeof vi.fn>).mock.calls.length,
        1,
      ),
    );
  });

  it("hides the footer action while a finalize is already distilling or under review", () => {
    planningSession.current = makeSession({
      activeLayerId: "L-active",
      sessionState: { status: "converged", round: 2, maxRounds: 4 },
      finalize: { phase: "review", text: "name: spec" },
    });
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);
    assert.equal(
      Array.from(document.querySelectorAll("button")).find((b) =>
        /Finalize → Generate manifest/.test(b.textContent || ""),
      ),
      undefined,
      "no duplicate Finalize while the review is open",
    );
  });
});
