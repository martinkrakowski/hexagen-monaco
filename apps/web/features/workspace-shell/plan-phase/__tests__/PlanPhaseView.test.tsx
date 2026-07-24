vi.stubGlobal("crypto", {
  randomUUID: () => "turn-uuid",
} as unknown as Crypto);

import { describe, it, vi, beforeEach, beforeAll, afterAll } from "vitest";
import assert from "node:assert";
import React from "react";
import {
  render as rtlRender,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";

// PlanPhaseView reads the project + layer mutations from the wizard lifecycle
// context. Mock the hook (the provider needs the whole workspace tree).
const lifecycle = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));
vi.mock("../../contexts/WizardLifecycleContext", () => ({
  useWizardLifecycleContext: () => lifecycle.current,
}));

// Selection lives in the `?layer=` URL param (PR B): replace the inert global
// next/navigation stub with the stateful one, so a row click — which only
// calls router.replace — actually re-renders the view under test.
vi.mock("next/navigation", async () =>
  (await import("./nav-stub")).statefulNavigationMock(),
);
import { navState } from "./nav-stub";

import { PlanPhaseView } from "../PlanPhaseView";
import { FormProvider, useForm } from "react-hook-form";
import { emptyFormValues } from "../../../project-wizard/config";

// PlanPhaseView renders ProjectSettingsSection, whose governance fields read
// the shared wizard form via `useFormContext`. Production supplies it through
// WizardStepFormProvider; here a lightweight FormProvider harness stands in.
// Shadowing `render` routes every existing call site through the wrapper without
// touching them.
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

// The workbench's desktop path (jsdom default width 1024 = "lg") renders
// react-resizable-panels, which instantiates a ResizeObserver on mount; jsdom
// doesn't ship one. Stub + restore so the stub can't leak into sibling suites.
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

const bodyText = () => (document.body.textContent || "").replace(/\s+/g, " ");

// The right pane hosts the seed composer; the paste dialog's textarea must be
// selected by its label, not document order.
const transcriptTextarea = () =>
  document.querySelector(
    'textarea[aria-label="Session transcript (markdown)"]',
  ) as HTMLTextAreaElement;

const renderView = () => render(<PlanPhaseView onNavigateToImport={vi.fn()} />);

function button(label: RegExp): HTMLButtonElement {
  const btn = Array.from(document.querySelectorAll("button")).find((b) =>
    label.test(b.textContent || ""),
  );
  assert.ok(btn, `expected a button matching ${label}`);
  return btn as HTMLButtonElement;
}

/** A sessions-list row (inside the "Sessions and sources" nav) by its title. */
function sessionRow(title: RegExp): HTMLButtonElement {
  const nav = document.querySelector('nav[aria-label="Sessions and sources"]');
  assert.ok(nav, "the sessions nav is present");
  const row = Array.from(nav!.querySelectorAll("button")).find((b) =>
    title.test(b.textContent || ""),
  );
  assert.ok(row, `expected a sessions row matching ${title}`);
  return row as HTMLButtonElement;
}

function project(layers: unknown[] = []) {
  return {
    id: "p1",
    name: "Vellum",
    schemaVersion: 4,
    createdAt: 0,
    updatedAt: 0,
    formState: {},
    manifestYaml: "",
    layers,
  };
}

describe("PlanPhaseView (workbench host)", () => {
  beforeEach(() => {
    cleanup();
    navState.reset();
    lifecycle.current = {
      loadedProject: project(),
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
  });

  it("renders the guard state when no saved project is loaded (direct ?phase=plan URL)", () => {
    lifecycle.current.loadedProject = null;
    renderView();
    assert.match(bodyText(), /Save the project to attach planning sessions/);
  });

  it("renders the two-pane workbench chrome: shell title, accordion sections, live row, and the footer Add action", () => {
    renderView();
    const text = bodyText();
    assert.match(text, /Plan — Vellum/, "shell header carries the project");
    assert.match(text, /Project settings/);
    assert.match(text, /Sessions & sources/);
    assert.match(text, /Live session/);
    assert.match(
      text,
      /No archived sessions yet/,
      "empty archive state in the sessions list",
    );
    assert.ok(button(/Add planning session/), "left-footer add action");
    // Locked §5 Q2: the shell footer is EMPTY until the session converges.
    assert.strictEqual(
      Array.from(document.querySelectorAll("button")).find((b) =>
        /Finalize/.test(b.textContent || ""),
      ),
      undefined,
      "no Finalize action before convergence",
    );
  });

  it("shows the seed composer with the ADR-0045 quota caption when no session is tracked", () => {
    renderView();
    assert.ok(
      document.querySelector('textarea[aria-label="Session brief"]'),
      "seed composer in the right pane",
    );
    assert.match(
      bodyText(),
      /Each round uses 2 AI chat requests from your daily quota\./,
    );
  });

  it("lists archived layers as rows and opens the full-height reader on click", () => {
    lifecycle.current.loadedProject = project([
      {
        id: "L1",
        kind: "brainstorm",
        title: "Initial brainstorm",
        createdAt: 1,
        updatedAt: 1,
        turns: [
          { id: "t1", author: "Grok", content: "propose" },
          { id: "t2", author: "Claude", content: "critique" },
        ],
      },
    ]);
    renderView();
    const row = sessionRow(/Initial brainstorm/);
    assert.match(row.textContent || "", /2 turns/);
    assert.match(row.textContent || "", /updated /);
    // Archived turns do NOT render until the layer is opened in the reader.
    assert.doesNotMatch(bodyText(), /critique/);

    fireEvent.click(row);
    const reader = document.querySelector(
      'section[aria-label="Planning session: Initial brainstorm"]',
    );
    assert.ok(reader, "the reader opens as the right-pane view");
    assert.match(bodyText(), /propose/);
    assert.match(bodyText(), /critique/);
    // The composer is hidden in the layer view (read-only transcript, §5 Q3).
    assert.strictEqual(
      document.querySelector('textarea[aria-label="Session brief"]'),
      null,
    );
  });

  it("orders archived rows NEWEST first by the displayed 'updated' timestamp", () => {
    // The sort key must match the timestamp the rows show: an older-created
    // but recently-updated layer sorts FIRST (sorting by createdAt made the
    // list read as unsorted against the only visible date).
    lifecycle.current.loadedProject = project([
      brainstormLayer({
        id: "L1",
        title: "First session",
        createdAt: 20,
        updatedAt: 10,
      }),
      brainstormLayer({
        id: "L2",
        title: "Second session",
        createdAt: 10,
        updatedAt: 20,
      }),
    ]);
    renderView();
    const text = bodyText();
    assert.ok(
      text.indexOf("Second session") < text.indexOf("First session"),
      "most recently UPDATED first, not stored or created order",
    );
  });

  it("adds a pasted session through addLayer with the loaded project's id", async () => {
    renderView();
    fireEvent.click(button(/Add planning session/));

    const textarea = transcriptTextarea();
    fireEvent.change(textarea, { target: { value: "the transcript" } });
    fireEvent.click(button(/Add session/));

    const addLayer = lifecycle.current.addLayer as ReturnType<typeof vi.fn>;
    await waitFor(() => assert.strictEqual(addLayer.mock.calls.length, 1));
    const [projectId, layer] = addLayer.mock.calls[0];
    assert.strictEqual(projectId, "p1");
    assert.strictEqual(layer.turns[0].content, "the transcript");
  });

  it("opens the INLINE add-session view from the left footer: full-height section, no modal, composer hidden, URL untouched", () => {
    renderView();
    fireEvent.click(button(/Add planning session/));

    assert.ok(
      document.querySelector('section[aria-label="Add planning session"]'),
      "the add-session view renders as the right-pane main view (req 4b)",
    );
    assert.strictEqual(
      document.querySelector("dialog[open]"),
      null,
      "no modal opens — the dialog is deleted",
    );
    assert.strictEqual(
      document.querySelector('textarea[aria-label="Session brief"]'),
      null,
      "the composer is hidden in the add-session view",
    );
    // Transient local state layered over the URL — never persisted to it.
    assert.doesNotMatch(navState.search, /layer=/);
    assert.strictEqual(navState.replaceCalls.length, 0);
  });

  it("Cancel returns to the previous view — the URL-derived reader underneath is restored", () => {
    lifecycle.current.loadedProject = project([brainstormLayer()]);
    renderView();
    fireEvent.click(sessionRow(/Initial brainstorm/));
    assert.match(navState.search, /layer=L1/);

    fireEvent.click(button(/Add planning session/));
    const addView = document.querySelector(
      'section[aria-label="Add planning session"]',
    );
    assert.ok(addView, "the add-session view replaced the reader");
    assert.match(
      navState.search,
      /layer=L1/,
      "opening the overlay never rewrites the URL",
    );

    const cancel = Array.from(addView.querySelectorAll("button")).find((b) =>
      /Cancel/.test(b.textContent || ""),
    ) as HTMLButtonElement;
    fireEvent.click(cancel);
    assert.ok(
      document.querySelector(
        'section[aria-label="Planning session: Initial brainstorm"]',
      ),
      "leaving the overlay restores the URL-derived layer view",
    );
  });

  it("on success leaves the add-session view and selects the NEW layer's reader (?layer= via replace, never push)", async () => {
    // Production-faithful addLayer: the new layer really lands in the
    // project, so the URL-derived view can resolve the fresh id.
    lifecycle.current.addLayer = vi.fn(
      async (_projectId: string, layer: Record<string, unknown>) => {
        const proj = lifecycle.current.loadedProject as {
          layers: unknown[];
        };
        proj.layers = [
          ...proj.layers,
          { id: "L-new", createdAt: 99, updatedAt: 99, ...layer },
        ];
        return "L-new";
      },
    );
    renderView();
    fireEvent.click(button(/Add planning session/));
    fireEvent.change(
      document.querySelector(
        'input[aria-label="Session title"]',
      ) as HTMLInputElement,
      { target: { value: "Imported plan" } },
    );
    fireEvent.change(transcriptTextarea(), {
      target: { value: "the transcript" },
    });
    fireEvent.click(button(/Add session/));

    await waitFor(() => {
      assert.ok(
        document.querySelector(
          'section[aria-label="Planning session: Imported plan"]',
        ),
        "the freshly created layer's reader is selected",
      );
    });
    assert.match(navState.search, /layer=L-new/);
    assert.strictEqual(
      navState.pushCalls.length,
      0,
      "selection always uses router.replace — no history spam",
    );
  });

  it("offers the empty-state secondary action in the EMPTY MAIN VIEW (plan §3.2), opening the add-session view", () => {
    renderView(); // zero layers → the live view IS the empty main view
    const action = button(/Add an existing transcript/);
    // Placement is part of the pin: §3.2 puts the action in the empty MAIN
    // view (right pane), not the Section B empty state in the left pane.
    assert.strictEqual(
      action.closest('nav[aria-label="Sessions and sources"]'),
      null,
      "the action does NOT live in the left-pane sessions nav",
    );
    assert.ok(
      action.closest('section[aria-label="Live planning session"]'),
      "the action lives in the right pane's empty main (live) view",
    );
    fireEvent.click(action);
    assert.ok(
      document.querySelector('section[aria-label="Add planning session"]'),
      "the secondary action opens the same inline add-session view",
    );
  });

  it("preserves a pasted transcript across a row-click leave and reopen (draft lifted to the host)", () => {
    // The add-session view is conditionally rendered, so a single click on a
    // sessions row unmounts it — the always-mounted dialog it replaced kept
    // the draft alive structurally. The draft is lifted to the host (exactly
    // like composerDraft) so the leave can't destroy a pasted transcript.
    lifecycle.current.loadedProject = project([brainstormLayer()]);
    renderView();
    fireEvent.click(button(/Add planning session/));
    fireEvent.change(transcriptTextarea(), {
      target: { value: "precious pasted transcript" },
    });
    fireEvent.change(
      document.querySelector(
        'input[aria-label="Session title"]',
      ) as HTMLInputElement,
      { target: { value: "Recovered notes" } },
    );

    fireEvent.click(sessionRow(/Initial brainstorm/));
    assert.strictEqual(
      document.querySelector('section[aria-label="Add planning session"]'),
      null,
      "the row click left the add-session view",
    );

    fireEvent.click(button(/Add planning session/));
    assert.strictEqual(
      transcriptTextarea().value,
      "precious pasted transcript",
      "the transcript survived the unmount",
    );
    assert.strictEqual(
      (
        document.querySelector(
          'input[aria-label="Session title"]',
        ) as HTMLInputElement
      ).value,
      "Recovered notes",
      "the title survived too",
    );
  });

  it("ignores row clicks while a submit is in flight (the old dialog's dismissible={!isSubmitting} gate, ported)", async () => {
    lifecycle.current.loadedProject = project([brainstormLayer()]);
    // Deferred, production-faithful addLayer: resolution is held open so the
    // in-flight window is observable; on success the layer really lands in
    // the project so the URL-derived view can resolve the fresh id.
    let resolveAdd!: (id: string | null) => void;
    lifecycle.current.addLayer = vi.fn(
      (_projectId: string, layer: Record<string, unknown>) =>
        new Promise<string | null>((resolve) => {
          resolveAdd = (id) => {
            if (id !== null) {
              const proj = lifecycle.current.loadedProject as {
                layers: unknown[];
              };
              proj.layers = [
                ...proj.layers,
                { id, createdAt: 99, updatedAt: 99, ...layer },
              ];
            }
            resolve(id);
          };
        }),
    );
    renderView();
    fireEvent.click(button(/Add planning session/));
    fireEvent.change(transcriptTextarea(), {
      target: { value: "in-flight transcript" },
    });
    fireEvent.click(button(/Add session/));

    // Mid-write, a row click must NOT unmount the form: a failure after the
    // unmount would land on nothing, and a success would yank the selection
    // the user just made (the modal's dismissible gate blocked exactly this).
    fireEvent.click(sessionRow(/Initial brainstorm/));
    assert.ok(
      document.querySelector('section[aria-label="Add planning session"]'),
      "the add-session view stays mounted while the write is in flight",
    );
    assert.doesNotMatch(navState.search, /layer=/);

    resolveAdd("L-new");
    await waitFor(() => assert.match(navState.search, /layer=L-new/));
    assert.strictEqual(
      document.querySelector('section[aria-label="Add planning session"]'),
      null,
      "the success arm still leaves the view and selects the new layer",
    );
  });

  it("does not show a stale persistence error from an unrelated write before any submit", () => {
    // persistError is instance-wide (a failed wizard autosave sets it too);
    // opening the dialog must not present it as a session-save failure.
    lifecycle.current.layersPersistError = {
      kind: "SerializationFailed",
      message: "unrelated autosave failure",
    };
    renderView();
    fireEvent.click(button(/Add planning session/));
    assert.strictEqual(
      document.querySelector('[role="alert"]'),
      null,
      "no error shown before a submit from this dialog",
    );
  });

  it("shows generic failure copy when addLayer fails without a persistence error", async () => {
    lifecycle.current.addLayer = vi.fn(async () => null);
    lifecycle.current.layersPersistError = null;
    renderView();
    fireEvent.click(button(/Add planning session/));
    const textarea = transcriptTextarea();
    fireEvent.change(textarea, { target: { value: "content" } });
    fireEvent.click(button(/Add session/));

    await waitFor(() => {
      const alert = document.querySelector('[role="alert"]');
      assert.ok(alert, "failure without a mapped error still surfaces");
      assert.match(alert.textContent || "", /Couldn't save the session/);
    });
  });

  it("maps a quota failure to actionable copy", async () => {
    lifecycle.current.addLayer = vi.fn(async () => null);
    lifecycle.current.layersPersistError = {
      kind: "StorageQuotaExceeded",
      message: "IDB storage quota exceeded",
    };
    renderView();
    fireEvent.click(button(/Add planning session/));
    const textarea = transcriptTextarea();
    fireEvent.change(textarea, { target: { value: "big transcript" } });
    fireEvent.click(button(/Add session/));

    await waitFor(() => {
      const alert = document.querySelector('[role="alert"]');
      assert.ok(alert, "quota error surfaces inline");
      assert.match(alert.textContent || "", /Not enough browser storage/);
    });
  });
});

// --- Reader actions: provenance, rename, delete, extraction -----------------

function brainstormLayer(overrides: Record<string, unknown> = {}) {
  return {
    id: "L1",
    kind: "brainstorm",
    title: "Initial brainstorm",
    createdAt: 10,
    updatedAt: 10,
    turns: [{ id: "t1", author: "Grok", content: "propose" }],
    ...overrides,
  };
}

function buttonByAriaLabel(label: string, root: ParentNode = document) {
  return root.querySelector(
    `button[aria-label="${label}"]`,
  ) as HTMLButtonElement | null;
}

describe("PlanPhaseView (reader actions)", () => {
  beforeEach(() => {
    cleanup();
    navState.reset();
    lifecycle.current = {
      loadedProject: project(),
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
    // Default fetch stub (per test — NOT unstubAllGlobals, which would also
    // tear down vitest.setup.ts's localStorage/sessionStorage stubs and expose
    // Node's throwing localStorage getter). Extraction tests override it.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => null })),
    );
  });

  it("shows kind badges on rows and offers extraction only in a brainstorm layer's reader", () => {
    lifecycle.current.loadedProject = project([
      brainstormLayer(),
      {
        id: "D1",
        kind: "decisions",
        title: "Decisions — Initial brainstorm",
        sourceLayerId: "L1",
        createdAt: 20,
        updatedAt: 20,
        turns: [{ id: "t2", author: "AI", content: "## Decisions" }],
      },
    ]);
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);
    const text = bodyText();
    assert.match(text, /Brainstorm/);
    assert.match(text, /Decisions —/);

    fireEvent.click(sessionRow(/Decisions —/));
    assert.strictEqual(
      Array.from(document.querySelectorAll("button")).find((b) =>
        /Extract decisions/.test(b.textContent || ""),
      ),
      undefined,
      "decisions layers do not offer extraction",
    );

    // Anchored: the decisions row's title ("Decisions — Initial brainstorm")
    // also CONTAINS the brainstorm title, and it sorts first (newest-first).
    fireEvent.click(sessionRow(/^Initial brainstorm/));
    assert.ok(button(/Extract decisions/), "brainstorm reader offers it");
  });

  it("renames a layer through the awaited updateLayer and surfaces failure inline", async () => {
    lifecycle.current.loadedProject = project([brainstormLayer()]);
    lifecycle.current.updateLayer = vi.fn(async () => false);
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);
    fireEvent.click(sessionRow(/Initial brainstorm/));

    fireEvent.click(buttonByAriaLabel("Rename session")!);
    const input = document.querySelector(
      'input[aria-label="Session title"]',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Renamed session" } });
    fireEvent.click(buttonByAriaLabel("Save title")!);

    const updateLayer = lifecycle.current.updateLayer as ReturnType<
      typeof vi.fn
    >;
    await waitFor(() => assert.strictEqual(updateLayer.mock.calls.length, 1));
    assert.deepStrictEqual(updateLayer.mock.calls[0], [
      "p1",
      "L1",
      { title: "Renamed session" },
    ]);
    // Failed write → error inline, editor stays open with the draft.
    await waitFor(() => {
      const alert = document.querySelector('[role="alert"]');
      assert.ok(alert, "rename failure surfaces inline");
      assert.match(alert.textContent || "", /Couldn't save the new title/);
    });
    assert.ok(
      document.querySelector('input[aria-label="Session title"]'),
      "rename editor stays open on failure",
    );
  });

  it("moves focus into the rename input on open and back to the trigger on cancel", async () => {
    lifecycle.current.loadedProject = project([brainstormLayer()]);
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);
    fireEvent.click(sessionRow(/Initial brainstorm/));

    // Opening rename unmounts the pencil trigger — without explicit focus
    // management keyboard focus falls to <body>.
    fireEvent.click(buttonByAriaLabel("Rename session")!);
    const input = document.querySelector(
      'input[aria-label="Session title"]',
    ) as HTMLInputElement;
    await waitFor(() => assert.strictEqual(document.activeElement, input));

    fireEvent.click(buttonByAriaLabel("Cancel rename")!);
    await waitFor(() =>
      assert.strictEqual(
        document.activeElement,
        buttonByAriaLabel("Rename session"),
        "cancel returns focus to the re-mounted rename trigger",
      ),
    );
  });

  it("does not commit a rename on Enter during IME composition", async () => {
    lifecycle.current.loadedProject = project([brainstormLayer()]);
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);
    fireEvent.click(sessionRow(/Initial brainstorm/));

    fireEvent.click(buttonByAriaLabel("Rename session")!);
    const input = document.querySelector(
      'input[aria-label="Session title"]',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Renamed session" } });

    // Enter while composing commits the IME candidate, not the rename.
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    const updateLayer = lifecycle.current.updateLayer as ReturnType<
      typeof vi.fn
    >;
    assert.strictEqual(updateLayer.mock.calls.length, 0);
    assert.ok(
      document.querySelector('input[aria-label="Session title"]'),
      "the editor stays open",
    );

    // A plain Enter still commits.
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => assert.strictEqual(updateLayer.mock.calls.length, 1));
  });

  it("deletes a layer only after the confirm dialog, and falls back to the live view", async () => {
    lifecycle.current.loadedProject = project([brainstormLayer()]);
    // Production-faithful mock: removeLayer really shrinks the project's
    // layers (the suite default resolves true but leaves the list intact,
    // which would let resolvedView keep resolving the dead id). The direct
    // unknown-id normalization pin lives in the archive-filter suite; this
    // flow's live view additionally comes from confirmDelete's explicit
    // mainView reset.
    lifecycle.current.removeLayer = vi.fn(
      async (_projectId: string, layerId: string) => {
        const proj = lifecycle.current.loadedProject as {
          layers: { id: string }[];
        };
        proj.layers = proj.layers.filter((l) => l.id !== layerId);
        return true;
      },
    );
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);
    fireEvent.click(sessionRow(/Initial brainstorm/));

    const removeLayer = lifecycle.current.removeLayer as ReturnType<
      typeof vi.fn
    >;
    fireEvent.click(buttonByAriaLabel("Delete session")!);
    assert.strictEqual(
      removeLayer.mock.calls.length,
      0,
      "no removal before the confirm",
    );
    assert.match(bodyText(), /Delete planning session\?/);

    fireEvent.click(button(/^\s*Delete session\s*$/));
    await waitFor(() => assert.strictEqual(removeLayer.mock.calls.length, 1));
    assert.deepStrictEqual(removeLayer.mock.calls[0], ["p1", "L1"]);
    // Deleting the on-screen layer falls back to the live view (no dead pane).
    await waitFor(() => {
      assert.doesNotMatch(bodyText(), /Delete planning session\?/);
      assert.match(bodyText(), /Start a live session/);
    });
  });

  it("keeps the confirm dialog open with an inline error when removal fails", async () => {
    lifecycle.current.loadedProject = project([brainstormLayer()]);
    lifecycle.current.removeLayer = vi.fn(async () => false);
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);
    fireEvent.click(sessionRow(/Initial brainstorm/));

    fireEvent.click(buttonByAriaLabel("Delete session")!);
    fireEvent.click(button(/^\s*Delete session\s*$/));

    await waitFor(() => {
      const alert = document.querySelector('[role="alert"]');
      assert.ok(alert, "delete failure surfaces inline");
      assert.match(alert.textContent || "", /Couldn't delete the session/);
    });
    assert.match(bodyText(), /Delete planning session\?/, "dialog stays open");
  });

  it("badges the layer that produced the manifest and switches back on click only", () => {
    lifecycle.current.loadedProject = project([
      brainstormLayer({
        link: { type: "produced-manifest", at: 42 },
      }),
    ]);
    const onSwitch = vi.fn();
    render(
      <PlanPhaseView
        onNavigateToImport={vi.fn()}
        onSwitchToArchitecture={onSwitch}
      />,
    );

    assert.match(bodyText(), /Produced this architecture/);
    fireEvent.click(sessionRow(/Initial brainstorm/));
    assert.strictEqual(onSwitch.mock.calls.length, 0, "never auto-navigates");
    fireEvent.click(button(/View architecture/));
    assert.strictEqual(onSwitch.mock.calls.length, 1);
  });

  it("extracts decisions into a new decisions layer via the awaited addLayer", async () => {
    lifecycle.current.loadedProject = project([brainstormLayer()]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ decisions: "## Decisions\n\n- ship it" }),
      })),
    );
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);
    fireEvent.click(sessionRow(/Initial brainstorm/));

    fireEvent.click(button(/Extract decisions/));

    const addLayer = lifecycle.current.addLayer as ReturnType<typeof vi.fn>;
    await waitFor(() => assert.strictEqual(addLayer.mock.calls.length, 1));
    const [projectId, layer] = addLayer.mock.calls[0];
    assert.strictEqual(projectId, "p1");
    assert.strictEqual(layer.kind, "decisions");
    assert.strictEqual(layer.title, "Decisions — Initial brainstorm");
    assert.strictEqual(layer.sourceLayerId, "L1");
    assert.strictEqual(layer.turns.length, 1);
    assert.strictEqual(layer.turns[0].author, "AI");
    assert.match(layer.turns[0].content, /ship it/);

    // The transcript sent to the route is the authored markdown of the turns.
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0];
    assert.strictEqual(url, "/api/plan/extract-decisions");
    const body = JSON.parse((init as RequestInit).body as string);
    assert.match(body.transcript, /## Grok\n\npropose/);
    assert.strictEqual(body.title, "Initial brainstorm");
  });

  it("surfaces the persist-failure copy when extraction succeeds but addLayer fails", async () => {
    lifecycle.current.loadedProject = project([brainstormLayer()]);
    lifecycle.current.addLayer = vi.fn(async () => null);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ decisions: "## Decisions\n\n- ship it" }),
      })),
    );
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);
    fireEvent.click(sessionRow(/Initial brainstorm/));

    fireEvent.click(button(/Extract decisions/));

    await waitFor(() => {
      const alert = document.querySelector('[role="alert"]');
      assert.ok(alert, "save failure after a successful extraction surfaces");
      assert.match(
        alert.textContent || "",
        /Extracted the summary, but couldn't save it/,
      );
    });
    const retry = button(/Extract decisions/);
    assert.strictEqual(retry.disabled, false, "action re-enabled for retry");
  });

  it("surfaces an extraction failure inline and keeps the view usable", async () => {
    lifecycle.current.loadedProject = project([brainstormLayer()]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ error: "Daily quota exhausted" }),
      })),
    );
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);
    fireEvent.click(sessionRow(/Initial brainstorm/));

    fireEvent.click(button(/Extract decisions/));

    await waitFor(() => {
      const alert = document.querySelector('[role="alert"]');
      assert.ok(alert, "extraction failure surfaces inline");
      assert.match(alert.textContent || "", /Daily quota exhausted/);
    });
    const addLayer = lifecycle.current.addLayer as ReturnType<typeof vi.fn>;
    assert.strictEqual(addLayer.mock.calls.length, 0);
    assert.ok(button(/Extract decisions/), "action available for retry");
  });
});
