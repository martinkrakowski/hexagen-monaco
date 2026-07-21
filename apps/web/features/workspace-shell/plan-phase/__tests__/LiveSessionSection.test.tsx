import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert";
import React from "react";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { ProjectLayer } from "@hexagen/shared";

// Finalize distills via one chat call — mock the stream, not the whole flow.
const distillMock = vi.hoisted(() => ({
  impl: vi.fn(async () => ({ ok: true as const, content: "name: distilled" })),
}));
vi.mock("../session/stream-chat-turn", () => ({
  streamChatTurn: (...args: unknown[]) => distillMock.impl(...args),
}));

import { LiveSessionSection } from "../LiveSessionSection";
import type { UsePlanningSessionReturn } from "../session/usePlanningSession";
import type { PlanningSessionState } from "../session/planning-session";
import { usePendingManifest } from "../../../manifest-generation/store/usePendingManifest";

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
    start: vi.fn(async () => {}),
    attach: vi.fn(),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    addSteering: vi.fn(async () => {}),
    forceConverge: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
    beginFinalize: vi.fn(async () => {}),
    completeFinalize: vi.fn(async () => {}),
    cancelFinalize: vi.fn(async () => {}),
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
}) {
  return render(
    <LiveSessionSection
      projectId="p1"
      layers={props.layers ?? []}
      session={props.session}
      onNavigateToImport={props.onNavigateToImport ?? vi.fn()}
    />,
  );
}

describe("LiveSessionSection", () => {
  beforeEach(() => {
    cleanup();
    sessionStorage.clear();
    usePendingManifest.getState().clear();
    distillMock.impl = vi.fn(async () => ({
      ok: true as const,
      content: "name: distilled",
    }));
  });

  it("shows the seed form with the quota-cost note when no session is tracked", () => {
    renderSection({ session: makeSession() });
    assert.match(bodyText(), /Start a live session/);
    assert.match(bodyText(), /2 AI chat requests/);
    const startButton = button(/Start live session/);
    assert.ok(startButton.disabled, "start disabled without a brief");
  });

  it("start() receives the typed brief", async () => {
    const session = makeSession();
    renderSection({ session });
    const textarea = document.querySelector(
      'textarea[aria-label="Session brief"]',
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Build a todo app" } });
    fireEvent.click(button(/Start live session/));
    await waitFor(() =>
      assert.deepStrictEqual(
        (session.start as ReturnType<typeof vi.fn>).mock.calls,
        [["Build a todo app"]],
      ),
    );
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

  it("awaiting-human exposes steering, Resume, and Force converge; steering text is sent", async () => {
    const session = makeSession({
      sessionState: state({
        status: "awaiting-human",
        awaitReason: "cap-reached",
        resumeStatus: "revising",
        round: 4,
      }),
      activeLayerId: "L1",
    });
    renderSection({ session });

    assert.match(bodyText(), /Round cap reached/);
    assert.ok(button(/Resume/));
    assert.ok(button(/Force converge/));
    const textarea = document.querySelector(
      'textarea[aria-label="Steering note"]',
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "focus on billing" } });
    fireEvent.click(button(/Add steering turn/));
    await waitFor(() =>
      assert.deepStrictEqual(
        (session.addSteering as ReturnType<typeof vi.fn>).mock.calls,
        [["focus on billing"]],
      ),
    );
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

  it("finalize: distills to an editable review and does NOT navigate or hand off before Confirm", async () => {
    distillMock.impl = vi.fn(async () => ({
      ok: true as const,
      content: "```yaml\nname: distilled-app\ncontexts: []\n```",
    }));
    const onNavigateToImport = vi.fn();
    const session = makeSession({
      sessionState: state({ status: "converged", round: 2 }),
      activeLayerId: "L1",
      seed: "the brief",
      turns: [{ id: "t1", author: "You", content: "the brief", role: "human" }],
    });
    renderSection({ session, onNavigateToImport });

    fireEvent.click(button(/Finalize → Generate manifest/));
    await waitFor(() =>
      assert.ok(document.querySelector('[data-testid="finalize-review"]')),
    );
    assert.strictEqual(
      (session.beginFinalize as ReturnType<typeof vi.fn>).mock.calls.length,
      1,
    );

    // The fenced YAML is stripped into the editable textarea.
    const review = document.querySelector(
      'textarea[aria-label="Distilled spec"]',
    ) as HTMLTextAreaElement;
    assert.strictEqual(review.value, "name: distilled-app\ncontexts: []");

    // CRITICAL: review shown ≠ hand-off. Nothing moves until Confirm.
    assert.strictEqual(onNavigateToImport.mock.calls.length, 0);
    assert.strictEqual(usePendingManifest.getState().originSession, null);
    assert.strictEqual(sessionStorage.getItem("import_spec_content"), null);
    assert.strictEqual(
      (session.completeFinalize as ReturnType<typeof vi.fn>).mock.calls.length,
      0,
    );
  });

  it("Confirm hands off the EDITED spec + session provenance, completes finalize, then navigates", async () => {
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
      sessionState: state({ status: "converged", round: 1 }),
      activeLayerId: "L42",
      seed: "the brief",
      turns,
    });
    renderSection({ session, onNavigateToImport });

    fireEvent.click(button(/Finalize → Generate manifest/));
    await waitFor(() =>
      assert.ok(document.querySelector('[data-testid="finalize-review"]')),
    );
    const review = document.querySelector(
      'textarea[aria-label="Distilled spec"]',
    ) as HTMLTextAreaElement;
    fireEvent.change(review, { target: { value: "name: edited-by-human" } });
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
    assert.strictEqual(
      (session.completeFinalize as ReturnType<typeof vi.fn>).mock.calls.length,
      1,
    );
  });

  it("Cancel in review abandons the finalize without navigation or hand-off", async () => {
    const onNavigateToImport = vi.fn();
    const session = makeSession({
      sessionState: state({ status: "converged" }),
      activeLayerId: "L1",
      seed: "s",
      turns: [],
    });
    renderSection({ session, onNavigateToImport });

    fireEvent.click(button(/Finalize → Generate manifest/));
    await waitFor(() =>
      assert.ok(document.querySelector('[data-testid="finalize-review"]')),
    );
    fireEvent.click(button(/^\s*Cancel\s*$/));

    await waitFor(() =>
      assert.strictEqual(
        (session.cancelFinalize as ReturnType<typeof vi.fn>).mock.calls.length,
        1,
      ),
    );
    assert.strictEqual(onNavigateToImport.mock.calls.length, 0);
    assert.strictEqual(usePendingManifest.getState().originSession, null);
    assert.strictEqual(sessionStorage.getItem("import_spec_content"), null);
  });

  it("a failed distillation surfaces an error and returns the session to converged", async () => {
    distillMock.impl = vi.fn(async () => ({
      ok: false as const,
      error: "model unavailable",
      aborted: false,
    }));
    const session = makeSession({
      sessionState: state({ status: "converged" }),
      activeLayerId: "L1",
    });
    renderSection({ session });

    fireEvent.click(button(/Finalize → Generate manifest/));
    await waitFor(() => {
      const alert = document.querySelector('[role="alert"]');
      assert.match(alert?.textContent ?? "", /model unavailable/);
    });
    assert.strictEqual(
      (session.cancelFinalize as ReturnType<typeof vi.fn>).mock.calls.length,
      1,
    );
  });
});
