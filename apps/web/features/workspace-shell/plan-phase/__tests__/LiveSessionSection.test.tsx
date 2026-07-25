import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { ProjectLayer } from "@hexagen/shared";

import { LiveSessionSection } from "../LiveSessionSection";
import type { UsePlanningSessionReturn } from "../session/usePlanningSession";
import type { PlanningSessionState } from "../session/planning-session";
import { usePendingManifest } from "../../../manifest-generation/store/usePendingManifest";

// A2: LiveSessionSection is the workbench right pane's LIVE view and is
// deliberately STATELESS about drafts and finalize — the composer lives in the
// host and the finalize state lives in usePlanningSession. This suite drives
// it purely through the session prop; the full finalize FLOW (real hook) is
// pinned in PlanWorkbench.test.tsx.

const bodyText = () => (document.body.textContent || "").replace(/\s+/g, " ");

function button(label: RegExp): HTMLButtonElement {
  const btn = Array.from(document.querySelectorAll("button")).find((b) =>
    label.test(b.textContent || ""),
  );
  assert.ok(btn, `expected a button matching ${label}`);
  return btn as HTMLButtonElement;
}

function noButton(label: RegExp): void {
  const btn = Array.from(document.querySelectorAll("button")).find((b) =>
    label.test(b.textContent || ""),
  );
  assert.strictEqual(btn, undefined, `expected NO button matching ${label}`);
}

function makeSession(
  overrides: Partial<UsePlanningSessionReturn> = {},
): UsePlanningSessionReturn {
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

function state(partial: Partial<PlanningSessionState>): PlanningSessionState {
  return {
    status: "proposing",
    round: 1,
    maxRounds: 4,
    nextRole: "proposer",
    ...partial,
  };
}

function layer(partial: Partial<ProjectLayer>): ProjectLayer {
  return {
    id: "L1",
    kind: "brainstorm",
    title: "Live session: seed",
    createdAt: 1,
    updatedAt: 1,
    turns: [],
    ...partial,
  } as ProjectLayer;
}

function renderSection(props: {
  session: UsePlanningSessionReturn;
  layers?: readonly ProjectLayer[];
  onNavigateToImport?: () => void;
  onAddSession?: () => void;
}) {
  return render(
    <LiveSessionSection
      projectId="p1"
      layers={props.layers ?? []}
      session={props.session}
      onNavigateToImport={props.onNavigateToImport ?? vi.fn()}
      onAddSession={props.onAddSession}
    />,
  );
}

describe("LiveSessionSection", () => {
  beforeEach(() => {
    cleanup();
    sessionStorage.clear();
    usePendingManifest.getState().clear();
  });

  it("shows the intro when no session is tracked — the seed composer is the HOST's, not this view's", () => {
    renderSection({ session: makeSession() });
    assert.match(bodyText(), /Start a live session/);
    assert.match(bodyText(), /composer below/);
    assert.strictEqual(
      document.querySelector("textarea"),
      null,
      "no draft-owning input in the live view (A2 lift)",
    );
  });

  it("zero-layer empty state offers the 'Add an existing transcript' secondary action (plan §3.2: the EMPTY MAIN VIEW keeps it)", () => {
    const onAddSession = vi.fn();
    renderSection({ session: makeSession(), onAddSession });
    fireEvent.click(button(/Add an existing transcript/));
    assert.equal(onAddSession.mock.calls.length, 1);
  });

  it("hides the secondary action once the project has any layer (an empty-state pitch, not a fixture)", () => {
    renderSection({
      session: makeSession(),
      layers: [layer({ id: "a" })],
      onAddSession: vi.fn(),
    });
    noButton(/Add an existing transcript/);
  });

  it("shows the interrupted banner for a persisted non-terminal session; Resume attaches and resumes", async () => {
    const interrupted = layer({ id: "L7", status: "critiquing" });
    const session = makeSession();
    renderSection({ session, layers: [interrupted] });

    assert.match(bodyText(), /A live session was interrupted/);
    fireEvent.click(button(/Resume session/));
    await waitFor(() => {
      assert.deepStrictEqual(
        (session.attach as ReturnType<typeof vi.fn>).mock.calls,
        [[interrupted]],
      );
      assert.strictEqual(
        (session.resume as ReturnType<typeof vi.fn>).mock.calls.length,
        1,
      );
    });
  });

  it("End on the banner attaches and ends the interrupted session", async () => {
    const interrupted = layer({ id: "L7", status: "awaiting-human" });
    const session = makeSession();
    renderSection({ session, layers: [interrupted] });
    fireEvent.click(button(/End session/));
    await waitFor(() =>
      assert.strictEqual(
        (session.end as ReturnType<typeof vi.fn>).mock.calls.length,
        1,
      ),
    );
  });

  it("shows no banner when layers are plain archives or done sessions", () => {
    renderSection({
      session: makeSession(),
      layers: [layer({ id: "a" }), layer({ id: "b", status: "done" })],
    });
    assert.doesNotMatch(bodyText(), /interrupted/);
  });

  it("renders the status chip, round indicator, turns, and streaming draft while running", () => {
    const session = makeSession({
      sessionState: state({ status: "critiquing", round: 2 }),
      activeLayerId: "L1",
      isRunning: true,
      turns: [
        { id: "t1", author: "You", content: "the brief", role: "human" },
        {
          id: "t2",
          author: "Proposer",
          content: "a proposal",
          role: "proposer",
        },
      ],
      draft: { role: "critic", content: "partial critique…" },
    });
    renderSection({ session });

    const chip = document.querySelector('[data-testid="session-status-chip"]');
    assert.strictEqual(chip?.textContent, "Critiquing");
    assert.match(bodyText(), /Round 2 of 4/);
    assert.match(bodyText(), /a proposal/);
    assert.match(bodyText(), /partial critique/);
    assert.ok(button(/Pause/));
    noButton(/Resume/);
  });

  it("awaiting-human (cap reached) exposes Resume and Force converge with the cap copy", () => {
    renderSection({
      session: makeSession({
        sessionState: state({
          status: "awaiting-human",
          awaitReason: "cap-reached",
          resumeStatus: "revising",
          round: 4,
        }),
        activeLayerId: "L1",
      }),
    });

    assert.match(bodyText(), /Round cap reached/);
    assert.ok(button(/Resume/));
    assert.ok(button(/Force converge/));
  });

  it("surfaces a stream error as an alert, never a silent stall", () => {
    renderSection({
      session: makeSession({
        sessionState: state({
          status: "awaiting-human",
          awaitReason: "error",
          errorMessage: "Daily quota exceeded",
        }),
        activeLayerId: "L1",
      }),
    });
    const alert = document.querySelector('[role="alert"]');
    assert.match(alert?.textContent ?? "", /Daily quota exceeded/);
    assert.ok(button(/Resume/));
  });

  it("converged + idle finalize: hints at the shell-footer Finalize (no Finalize button HERE — locked §5 Q2)", () => {
    renderSection({
      session: makeSession({
        sessionState: state({ status: "converged", round: 2 }),
        activeLayerId: "L1",
      }),
    });
    assert.match(bodyText(), /The critic signed off/);
    noButton(/Finalize/);
  });

  it("distilling: renders the streamed content and Cancel wired to abandonFinalize", async () => {
    const session = makeSession({
      sessionState: state({ status: "finalizing", round: 2 }),
      activeLayerId: "L1",
      finalize: { phase: "distilling", content: "name: partial-spec" },
    });
    renderSection({ session });

    const distilling = document.querySelector(
      '[data-testid="finalize-distilling"]',
    );
    assert.ok(distilling);
    assert.strictEqual(
      distilling.getAttribute("role"),
      "status",
      "distill progress is announced to assistive tech",
    );
    assert.match(bodyText(), /name: partial-spec/);
    fireEvent.click(button(/^\s*Cancel\s*$/));
    await waitFor(() =>
      assert.strictEqual(
        (session.abandonFinalize as ReturnType<typeof vi.fn>).mock.calls.length,
        1,
      ),
    );
  });

  it("review: shows the lifted text, forwards edits to setFinalizeReviewText, and Cancel abandons", async () => {
    const session = makeSession({
      sessionState: state({ status: "finalizing", round: 2 }),
      activeLayerId: "L1",
      finalize: { phase: "review", text: "name: distilled-app" },
    });
    const onNavigateToImport = vi.fn();
    renderSection({ session, onNavigateToImport });

    const review = document.querySelector(
      'textarea[aria-label="Distilled spec"]',
    ) as HTMLTextAreaElement;
    assert.strictEqual(review.value, "name: distilled-app");

    fireEvent.change(review, { target: { value: "name: edited" } });
    assert.deepStrictEqual(
      (session.setFinalizeReviewText as ReturnType<typeof vi.fn>).mock.calls,
      [["name: edited"]],
    );

    // Review shown ≠ hand-off: nothing moves before Confirm.
    assert.strictEqual(onNavigateToImport.mock.calls.length, 0);
    assert.strictEqual(usePendingManifest.getState().originSession, null);
    assert.strictEqual(sessionStorage.getItem("import_spec_content"), null);

    fireEvent.click(button(/^\s*Cancel\s*$/));
    await waitFor(() =>
      assert.strictEqual(
        (session.abandonFinalize as ReturnType<typeof vi.fn>).mock.calls.length,
        1,
      ),
    );
    assert.strictEqual(onNavigateToImport.mock.calls.length, 0);
  });

  it("Confirm hands off the reviewed spec + session provenance and navigates; the review stays open", async () => {
    const onNavigateToImport = vi.fn();
    const turns = [
      { id: "t1", author: "You", content: "the brief", role: "human" as const },
      {
        id: "t2",
        author: "Proposer",
        content: "p1",
        role: "proposer" as const,
      },
    ];
    const session = makeSession({
      sessionState: state({ status: "finalizing", round: 1 }),
      activeLayerId: "L42",
      seed: "the brief",
      turns,
      finalize: { phase: "review", text: "name: edited-by-human" },
    });
    renderSection({ session, onNavigateToImport });

    fireEvent.click(button(/Confirm and continue to import/));

    await waitFor(() =>
      assert.strictEqual(onNavigateToImport.mock.calls.length, 1),
    );
    // Session provenance rides the store (NOT sessionStorage), keyed to the
    // exact confirmed spec text the accept-save will guard on.
    const origin = usePendingManifest.getState().originSession;
    assert.ok(origin);
    assert.strictEqual(origin.specText, "name: edited-by-human");
    assert.strictEqual(origin.sourceProjectId, "p1");
    assert.strictEqual(origin.sourceLayerId, "L42");
    assert.strictEqual(origin.turns.length, 2);
    // The import page rehydrates its editor from its own sessionStorage key.
    assert.strictEqual(
      sessionStorage.getItem("import_spec_content"),
      "name: edited-by-human",
    );
    // The review panel is NOT torn down: the workspace's navigation guard
    // dialog can cancel the navigation, and the user must land back on an
    // intact review, not a stranded session. The source layer is stamped done
    // by the import flow's accept-save (not here).
    assert.ok(document.querySelector('[data-testid="finalize-review"]'));
  });

  it("a finalize error phase surfaces as an alert with retry framing", () => {
    renderSection({
      session: makeSession({
        sessionState: state({ status: "converged" }),
        activeLayerId: "L1",
        finalize: { phase: "error", message: "model unavailable" },
      }),
    });
    const alert = document.querySelector('[role="alert"]');
    assert.match(alert?.textContent ?? "", /model unavailable/);
    assert.match(alert?.textContent ?? "", /you can retry/);
  });

  it("End session stays available during the review (teardown is the hook's job)", async () => {
    const session = makeSession({
      sessionState: state({ status: "finalizing" }),
      activeLayerId: "L1",
      finalize: { phase: "review", text: "name: spec" },
    });
    renderSection({ session });

    fireEvent.click(button(/End session/));
    await waitFor(() =>
      assert.strictEqual(
        (session.end as ReturnType<typeof vi.fn>).mock.calls.length,
        1,
      ),
    );
  });

  it("the done panel offers Start another session, which resets the hook", () => {
    const session = makeSession({
      sessionState: state({ status: "done" }),
      activeLayerId: "L1",
    });
    renderSection({ session });

    assert.match(bodyText(), /Session complete/);
    fireEvent.click(button(/Start another session/));
    assert.strictEqual(
      (session.reset as ReturnType<typeof vi.fn>).mock.calls.length,
      1,
    );
  });
});
