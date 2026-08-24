import { describe, it, vi, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { createElement, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ProjectLayer, ProjectLayerTurn } from "@hexagen/shared";

import type { UsePlanningFinalizeReturn } from "../session/usePlanningFinalize";
import { usePlanningFinalize } from "../session/usePlanningFinalize";
import { usePlanningSession } from "../session/usePlanningSession";
import type { PlanningSessionSnapshot } from "../session/planning-session";

/**
 * GOD-007 / item 8.6.
 *
 * `usePlanningSession` used to own the finalize/distill view-model as well as
 * the proposer⇄critic loop. It is now split, and the FIRST describe below is
 * the proof the split is real: the distill/review state machine is exercised
 * with NO planning loop in the tree at all — a hand-written session snapshot
 * and two spies stand in for the whole session hook. That is the benefit the
 * finding asked for ("loop reconcile and distill review can be tested
 * independently"); before the split this suite could not have been written.
 *
 * The SECOND describe composes the two real hooks the way `PlanPhaseView`
 * does, and pins the one seam between them: the discard epoch.
 */

const originalFetch = global.fetch;

// ── Scripted distill stream ─────────────────────────────────────────────────
// The distill is ONE POST /api/llm/chat (the same SSE contract as a loop turn).

type Script =
  | { kind: "reply"; content: string }
  // The two NON-abortive settlements of an ABORTED stream — the shapes that
  // reach `usePlanningFinalize` when a discard lands mid-distill but
  // `streamChatTurn` still returns `aborted: false`. See the two cases below.
  | { kind: "reply-after-abort"; content: string }
  | { kind: "http-error-json-hang"; status: number }
  | { kind: "error-frame"; message: string }
  | { kind: "hang" }; // resolves only by abort

function sseBody(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < frames.length) {
        controller.enqueue(encoder.encode(frames[index] + "\n"));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

/** A body that enqueues its frames only once `signal` aborts, then closes. */
function sseBodyOnAbort(
  signal: AbortSignal | null | undefined,
  frames: string[],
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    async pull(controller) {
      if (!signal?.aborted) {
        await new Promise<void>((resolve) =>
          signal?.addEventListener("abort", () => resolve()),
        );
      }
      if (index < frames.length) {
        controller.enqueue(encoder.encode(frames[index] + "\n"));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

let scripts: Script[] = [];
let requests: Array<{ message: string; signal: AbortSignal | undefined }> = [];

function installFetch() {
  global.fetch = vi.fn(
    async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body));
      requests.push({
        message: body.messages[0].content,
        signal: init?.signal ?? undefined,
      });
      const script = scripts.shift();
      if (!script) throw new Error("Unscripted chat request");
      if (script.kind === "hang") {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      }
      if (script.kind === "reply-after-abort") {
        // The terminal `done` frame is already buffered when the abort lands,
        // so `streamChatTurn`'s read loop completes NORMALLY and returns
        // `{ok:true}` on a stream whose signal is aborted. Modelled by a body
        // that only yields once the signal fires (a signal-unaware source, as a
        // buffered one is).
        return {
          ok: true,
          status: 200,
          body: sseBodyOnAbort(init?.signal, [
            `data: ${JSON.stringify({ type: "chunk", content: script.content })}`,
            `data: ${JSON.stringify({ type: "done" })}`,
          ]),
        } as unknown as Response;
      }
      if (script.kind === "http-error-json-hang") {
        // `stream-chat-turn.ts`'s `!response.ok` arm awaits `response.json()`
        // inside a `catch {}` that SWALLOWS the AbortError, then returns
        // `{ok:false, aborted:false}`. An HTTP-error response plus a discard
        // during the body read therefore reaches the hook as an ORDINARY
        // failure, with no `aborted` flag to gate on.
        return {
          ok: false,
          status: script.status,
          json: () =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () =>
                reject(new DOMException("Aborted", "AbortError")),
              );
            }),
        } as unknown as Response;
      }
      const frames =
        script.kind === "error-frame"
          ? [
              `data: ${JSON.stringify({ type: "error", message: script.message })}`,
            ]
          : [
              `data: ${JSON.stringify({ type: "chunk", content: script.content })}`,
              `data: ${JSON.stringify({ type: "done" })}`,
            ];
      return {
        ok: true,
        status: 200,
        body: sseBody(frames),
      } as unknown as Response;
    },
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  scripts = [];
  requests = [];
  installFetch();
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ── Isolation harness: no planning loop anywhere in the tree ────────────────

const TURNS: readonly ProjectLayerTurn[] = [
  { id: "t1", author: "You", content: "seed brief", role: "human" },
  { id: "t2", author: "Proposer", content: "Proposal v1", role: "proposer" },
];

function convergedSnapshot(): PlanningSessionSnapshot {
  return { status: "converged", seed: "seed brief", turns: TURNS };
}

function renderFinalize(initial?: {
  snapshot?: PlanningSessionSnapshot | null;
  epoch?: number;
}) {
  const session = {
    // `?? convergedSnapshot()` would silently turn an explicit `null` (the
    // no-session case) back into a converged session.
    snapshot:
      initial && "snapshot" in initial
        ? (initial.snapshot ?? null)
        : convergedSnapshot(),
    beginFinalize: vi.fn(async () => {}),
    cancelFinalize: vi.fn(async () => {}),
  };
  const rendered = renderHook(
    (props: { epoch: number }) =>
      usePlanningFinalize({
        readSession: () => session.snapshot,
        discardEpoch: props.epoch,
        beginFinalize: session.beginFinalize,
        cancelFinalize: session.cancelFinalize,
        model: "test-model",
      }),
    { initialProps: { epoch: initial?.epoch ?? 0 } },
  );
  return { ...rendered, session };
}

describe("usePlanningFinalize (in isolation — no planning loop)", () => {
  it("distills a converged session into an editable review with fences stripped", async () => {
    const { result, session } = renderFinalize();
    scripts = [
      { kind: "reply", content: "```yaml\nname: app\ncontexts: []\n```" },
    ];

    await act(async () => {
      await result.current.start();
    });

    assert.strictEqual(session.beginFinalize.mock.calls.length, 1);
    assert.deepStrictEqual(result.current.state, {
      phase: "review",
      text: "name: app\ncontexts: []",
    });
    // The distill prompt folds the seed and the transcript.
    assert.strictEqual(requests.length, 1);
    assert.match(requests[0].message, /seed brief/);
    assert.match(requests[0].message, /Proposal v1/);
  });

  it("refuses to distill unless the session is converged", async () => {
    const { result, session } = renderFinalize({
      snapshot: { status: "revising", seed: "s", turns: TURNS },
    });
    await act(async () => {
      await result.current.start();
    });
    assert.deepStrictEqual(result.current.state, { phase: "idle" });
    assert.strictEqual(session.beginFinalize.mock.calls.length, 0);
    assert.strictEqual(requests.length, 0);
  });

  it("refuses to distill when no session is tracked", async () => {
    const { result, session } = renderFinalize({ snapshot: null });
    await act(async () => {
      await result.current.start();
    });
    assert.deepStrictEqual(result.current.state, { phase: "idle" });
    assert.strictEqual(session.beginFinalize.mock.calls.length, 0);
    assert.strictEqual(requests.length, 0);
  });

  it("a double-click starts exactly ONE distill and ONE finalizing write", async () => {
    const { result, session } = renderFinalize();
    scripts = [{ kind: "reply", content: "spec" }];
    await act(async () => {
      const first = result.current.start();
      const second = result.current.start();
      await Promise.all([first, second]);
    });
    assert.strictEqual(requests.length, 1, "one distill request only");
    assert.strictEqual(session.beginFinalize.mock.calls.length, 1);
    assert.deepStrictEqual(result.current.state, {
      phase: "review",
      text: "spec",
    });
  });

  it("streams partial content into the distilling phase", async () => {
    const { result } = renderFinalize();
    scripts = [{ kind: "hang" }];
    await act(async () => {
      void result.current.start();
    });
    await waitFor(() =>
      assert.strictEqual(result.current.state.phase, "distilling"),
    );
  });

  it("a failed distill lands in the error phase, auto-cancels, and is retryable", async () => {
    const { result, session } = renderFinalize();
    scripts = [{ kind: "error-frame", message: "Daily quota exceeded" }];
    await act(async () => {
      await result.current.start();
    });
    assert.strictEqual(result.current.state.phase, "error");
    assert.match(
      result.current.state.phase === "error"
        ? result.current.state.message
        : "",
      /quota/i,
    );
    // The failed finalize hands the status back to the session hook, so a
    // reload cannot resurrect a phantom "finalizing" layer.
    assert.strictEqual(session.cancelFinalize.mock.calls.length, 1);

    scripts = [{ kind: "reply", content: "spec after retry" }];
    await act(async () => {
      await result.current.start();
    });
    assert.deepStrictEqual(result.current.state, {
      phase: "review",
      text: "spec after retry",
    });
  });

  it("abandon aborts the in-flight distill and returns to idle/converged; retry works", async () => {
    const { result, session } = renderFinalize();
    scripts = [{ kind: "hang" }];
    let distilling!: Promise<void>;
    await act(async () => {
      distilling = result.current.start();
    });
    await waitFor(() =>
      assert.strictEqual(result.current.state.phase, "distilling"),
    );
    assert.strictEqual(requests[0].signal?.aborted, false);

    await act(async () => {
      await result.current.abandon();
      await distilling;
    });
    assert.strictEqual(
      requests[0].signal?.aborted,
      true,
      "abandon aborts the in-flight distill stream",
    );
    assert.deepStrictEqual(result.current.state, { phase: "idle" });
    assert.strictEqual(session.cancelFinalize.mock.calls.length, 1);

    scripts = [{ kind: "reply", content: "second attempt" }];
    await act(async () => {
      await result.current.start();
    });
    assert.deepStrictEqual(result.current.state, {
      phase: "review",
      text: "second attempt",
    });
  });

  it("unmount aborts an in-flight distill stream (no zombie distill)", async () => {
    const { result, unmount } = renderFinalize();
    scripts = [{ kind: "hang" }];
    await act(async () => {
      void result.current.start();
    });
    await waitFor(() => assert.strictEqual(requests.length, 1));
    assert.strictEqual(requests[0].signal?.aborted, false);

    unmount();
    assert.strictEqual(
      requests[0].signal?.aborted,
      true,
      "teardown aborts the distill fetch",
    );
  });

  it("setReviewText edits the review; a stale edit after abandon is a no-op", async () => {
    const { result } = renderFinalize();
    scripts = [{ kind: "reply", content: "original spec" }];
    await act(async () => {
      await result.current.start();
    });
    act(() => {
      result.current.setReviewText("edited spec");
    });
    assert.deepStrictEqual(result.current.state, {
      phase: "review",
      text: "edited spec",
    });

    await act(async () => {
      await result.current.abandon();
    });
    act(() => {
      result.current.setReviewText("stale keystroke");
    });
    assert.deepStrictEqual(result.current.state, { phase: "idle" });
  });

  it("a bumped discard epoch drops the review and aborts an in-flight distill", async () => {
    const { result, rerender } = renderFinalize();
    scripts = [{ kind: "hang" }];
    await act(async () => {
      void result.current.start();
    });
    await waitFor(() =>
      assert.strictEqual(result.current.state.phase, "distilling"),
    );

    await act(async () => {
      rerender({ epoch: 1 });
    });
    assert.strictEqual(
      requests[0].signal?.aborted,
      true,
      "the discard epoch aborts the distill the discarded session owned",
    );
    assert.deepStrictEqual(result.current.state, { phase: "idle" });
  });

  it("a distill that SUCCEEDS after a discard does not republish the review", async () => {
    // A discard aborts the stream, but abort is not a guarantee the stream
    // settles abortively: if the terminal `done` frame was already buffered,
    // `streamChatTurn` returns `{ok:true}` and `result.aborted` is false. The
    // spec then belongs to a session that is gone — republishing it would put a
    // Confirm-able review back on screen whose `activeLayerId`/`turns` now come
    // from whatever session was attached instead.
    const { result, rerender } = renderFinalize();
    scripts = [
      { kind: "reply-after-abort", content: "spec for a dead session" },
    ];
    let distilling!: Promise<void>;
    await act(async () => {
      distilling = result.current.start();
    });
    await waitFor(() =>
      assert.strictEqual(result.current.state.phase, "distilling"),
    );

    act(() => {
      rerender({ epoch: 1 });
    });
    assert.strictEqual(requests[0].signal?.aborted, true);
    await act(async () => {
      await distilling;
    });
    assert.deepStrictEqual(
      result.current.state,
      { phase: "idle" },
      "a discarded distill must not publish its review",
    );
  });

  it("a distill that fails NON-abortively after a discard does not republish an error", async () => {
    // The reachable half: `stream-chat-turn.ts`'s `!response.ok` arm awaits
    // `response.json()` in a `catch {}` that swallows the AbortError and
    // returns `aborted: false`, so an HTTP-error response racing a discard
    // arrives as an ordinary failure. Publishing it would strand the discarded
    // session's pane in the error phase (with a Retry) and fire cancelFinalize
    // against whatever session is tracked now.
    const { result, session, rerender } = renderFinalize();
    scripts = [{ kind: "http-error-json-hang", status: 503 }];
    let distilling!: Promise<void>;
    await act(async () => {
      distilling = result.current.start();
    });
    await waitFor(() =>
      assert.strictEqual(result.current.state.phase, "distilling"),
    );

    act(() => {
      rerender({ epoch: 1 });
    });
    assert.strictEqual(requests[0].signal?.aborted, true);
    await act(async () => {
      await distilling;
    });
    assert.deepStrictEqual(
      result.current.state,
      { phase: "idle" },
      "a discarded distill must not publish an error phase",
    );
    assert.strictEqual(
      session.cancelFinalize.mock.calls.length,
      0,
      "no status write against a session that was already discarded",
    );
  });

  it("re-renders do not drop a live review — only a discard does", async () => {
    // The A2 lift itself, and the anti-vacuity arm for the epoch test above:
    // a teardown that fired on every commit would satisfy that test while
    // destroying the property this hook exists to provide.
    //
    // Named for what it actually pins. Two things hold it up together — the
    // discard effect's dependency array (React skips an effect whose deps are
    // unchanged) and the `seenEpochRef` comparison inside it. Removing ONLY
    // the comparison leaves this green, because the deps are stable today;
    // removing it while the effect re-runs for any other reason (a dependency
    // added to the effect or to `teardown`, a StrictMode remount) fails here.
    const { result, rerender } = renderFinalize();
    scripts = [{ kind: "reply", content: "kept spec" }];
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      rerender({ epoch: 0 });
      rerender({ epoch: 0 });
    });
    assert.deepStrictEqual(result.current.state, {
      phase: "review",
      text: "kept spec",
    });
  });
});

// ── Commit timing of the discard teardown ───────────────────────────────────

/** `waitFor` without RTL's act wrapper — this suite's timing test runs with the
 *  act environment deliberately off. */
async function pollUntil(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("pollUntil timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("discard teardown lands in the SAME commit", () => {
  it("no committed frame exposes a Confirm-able review from the discarded session", async () => {
    // WHY this is not just a style preference: a discard arrives from a
    // discrete click (attach / end / reset), which React renders and COMMITS
    // synchronously. A passive effect would run one Scheduler task later — and
    // the browser may paint in between. That painted frame showed the previous
    // session's review while `activeLayerId`/`turns` already pointed at the new
    // session, and `LiveSessionSection.handleFinalizeConfirm` gates only on
    // `finalize.phase === "review" && activeLayerId`, so a click landing there
    // filed the OLD spec text against the NEW layer.
    //
    // `flushSync` reproduces that discrete-click commit. This runs with the act
    // ENVIRONMENT OFF on purpose: inside `act`, React flushes passive effects at
    // every boundary, which erases the very distinction being measured (this
    // test passes with either effect kind when wrapped in act — verified). With
    // the flag off, passive effects go through the real Scheduler task, so
    // "already torn down when flushSync returns" is true only for a layout
    // effect.
    const actEnvKey = "IS_REACT_ACT_ENVIRONMENT";
    const globals = globalThis as unknown as Record<string, unknown>;
    const previousActEnv = globals[actEnvKey];
    globals[actEnvKey] = false;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      const snapshot = convergedSnapshot();
      let api!: UsePlanningFinalizeReturn;
      let bump!: () => void;
      function Harness() {
        const [epoch, setEpoch] = useState(0);
        bump = () => setEpoch((previous) => previous + 1);
        api = usePlanningFinalize({
          readSession: () => snapshot,
          discardEpoch: epoch,
          beginFinalize: async () => {},
          cancelFinalize: async () => {},
          model: "test-model",
        });
        return null;
      }
      flushSync(() => root.render(createElement(Harness)));

      // Get to the phase that actually carries the hazard: `review` is the one
      // with a Confirm button.
      scripts = [{ kind: "reply", content: "spec of the OLD session" }];
      await api.start();
      await pollUntil(() => api.state.phase === "review");

      // The discrete-click commit (attach / end / reset).
      flushSync(() => bump());

      // `api.state` here is what React has COMMITTED — the frame the browser can
      // paint and a click can hit. As a passive effect the teardown's
      // `setState({phase:"idle"})` is merely SCHEDULED at this point, so this
      // reads `{phase:"review", text:"spec of the OLD session"}` (measured).
      assert.deepStrictEqual(
        api.state,
        { phase: "idle" },
        "no committed frame may expose finalize state from the discarded session",
      );
    } finally {
      flushSync(() => root.unmount());
      container.remove();
      globals[actEnvKey] = previousActEnv;
    }
  });
});

// ── Composition: the two real hooks, wired as PlanPhaseView wires them ──────

const CONVERGED_LAYER: ProjectLayer = {
  id: "L1",
  kind: "brainstorm",
  title: "Live session: seed brief",
  createdAt: 1,
  updatedAt: 2,
  status: "converged",
  maxRounds: 4,
  turns: [
    { id: "t1", author: "You", content: "seed brief", role: "human" },
    {
      id: "t2",
      author: "Proposer",
      content: "Proposal v1",
      role: "proposer",
      round: 1,
    },
  ],
};

function renderComposed() {
  const updateLayer = vi.fn<
    (
      projectId: string,
      layerId: string,
      patch: { status?: string },
    ) => Promise<boolean>
  >(async () => true);
  const addLayer = vi.fn(async () => "L1");
  const appendLayerTurn = vi.fn(async () => null);
  const rendered = renderHook(() => {
    const session = usePlanningSession({
      projectId: "p1",
      addLayer,
      appendLayerTurn,
      updateLayer,
      model: "test-model",
      logger: { warn: vi.fn() },
    });
    const finalize = usePlanningFinalize({
      readSession: session.readSession,
      discardEpoch: session.discardEpoch,
      beginFinalize: session.beginFinalize,
      cancelFinalize: session.cancelFinalize,
      model: "test-model",
    });
    return { session, finalize };
  });
  return { ...rendered, updateLayer };
}

describe("usePlanningSession + usePlanningFinalize (composed)", () => {
  it("startFinalize persists finalizing and distills the attached session", async () => {
    const { result, updateLayer } = renderComposed();
    act(() => {
      result.current.session.attach(CONVERGED_LAYER);
    });
    scripts = [{ kind: "reply", content: "name: app" }];

    await act(async () => {
      await result.current.finalize.start();
    });

    assert.strictEqual(
      result.current.session.sessionState?.status,
      "finalizing",
    );
    assert.ok(
      updateLayer.mock.calls.some(
        (c) => (c[2] as { status?: string }).status === "finalizing",
      ),
      "finalizing status persisted before the distill",
    );
    assert.deepStrictEqual(result.current.finalize.state, {
      phase: "review",
      text: "name: app",
    });
    assert.match(requests[0].message, /seed brief/);
    assert.match(requests[0].message, /Proposal v1/);
  });

  it("end() during the review tears the finalize down (terminal done, idle finalize)", async () => {
    const { result } = renderComposed();
    act(() => {
      result.current.session.attach(CONVERGED_LAYER);
    });
    scripts = [{ kind: "reply", content: "spec" }];
    await act(async () => {
      await result.current.finalize.start();
    });
    assert.strictEqual(result.current.finalize.state.phase, "review");

    await act(async () => {
      await result.current.session.end();
    });
    assert.strictEqual(result.current.session.sessionState?.status, "done");
    assert.deepStrictEqual(result.current.finalize.state, { phase: "idle" });
  });

  it("attach() discards finalize progress belonging to the previous session", async () => {
    const { result } = renderComposed();
    act(() => {
      result.current.session.attach(CONVERGED_LAYER);
    });
    scripts = [{ kind: "hang" }];
    await act(async () => {
      void result.current.finalize.start();
    });
    await waitFor(() =>
      assert.strictEqual(result.current.finalize.state.phase, "distilling"),
    );

    const archived: ProjectLayer = {
      id: "L-old",
      kind: "brainstorm",
      title: "Old session",
      createdAt: 1,
      updatedAt: 2,
      status: "done",
      turns: [{ id: "t1", author: "You", content: "old", role: "human" }],
    };
    await act(async () => {
      result.current.session.attach(archived);
    });
    assert.strictEqual(requests[0].signal?.aborted, true);
    assert.deepStrictEqual(result.current.finalize.state, { phase: "idle" });
    assert.strictEqual(result.current.session.activeLayerId, "L-old");
  });

  it("reset() discards finalize progress", async () => {
    const { result } = renderComposed();
    act(() => {
      result.current.session.attach(CONVERGED_LAYER);
    });
    scripts = [{ kind: "reply", content: "spec" }];
    await act(async () => {
      await result.current.finalize.start();
    });
    assert.strictEqual(result.current.finalize.state.phase, "review");

    await act(async () => {
      result.current.session.reset();
    });
    assert.strictEqual(result.current.session.sessionState, null);
    assert.deepStrictEqual(result.current.finalize.state, { phase: "idle" });
  });
});
