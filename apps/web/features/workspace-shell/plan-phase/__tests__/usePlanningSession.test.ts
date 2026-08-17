import { describe, it, vi, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ProjectLayer } from "@hexagen/shared";

import { usePlanningSession } from "../session/usePlanningSession";

const originalFetch = global.fetch;

// ── Scripted streaming fetch ─────────────────────────────────────────────────
// Each model turn is one POST /api/llm/chat; the queue scripts them in order.

type Script =
  | { kind: "reply"; content: string }
  | { kind: "http-error"; status: number }
  | { kind: "error-frame"; message: string }
  | { kind: "hang" }; // resolves only by abort (pause/force-converge/end)

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
      if (script.kind === "http-error") {
        return {
          ok: false,
          status: script.status,
          json: async () => ({}),
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

// ── In-memory layer store (the injected lifecycle mutations) ────────────────

function makeMutations() {
  const layers = new Map<string, ProjectLayer>();
  let nextId = 0;
  const addLayer = vi.fn(
    async (_projectId: string, layer: unknown): Promise<string | null> => {
      const id = `layer-${++nextId}`;
      const l = layer as Omit<ProjectLayer, "id" | "createdAt" | "updatedAt">;
      layers.set(id, { ...l, id, createdAt: 1, updatedAt: 1 } as ProjectLayer);
      return id;
    },
  );
  const appendLayerTurn = vi.fn(
    async (
      _projectId: string,
      layerId: string,
      turn: { author: string; content: string },
      patch?: Partial<ProjectLayer>,
    ) => {
      const layer = layers.get(layerId);
      if (!layer) return null;
      const id = `turn-${++nextId}`;
      // Mirrors the real hook's contract: the COMMITTED turn (stamped id/at)
      // is returned so callers reuse the persisted timestamp.
      const committed = { ...turn, id, at: Date.now() };
      layers.set(layerId, {
        ...layer,
        ...patch,
        turns: [...layer.turns, committed],
      } as ProjectLayer);
      return committed;
    },
  );
  const updateLayer = vi.fn(
    async (
      _projectId: string,
      layerId: string,
      patch: Partial<ProjectLayer>,
    ) => {
      const layer = layers.get(layerId);
      if (!layer) return false;
      layers.set(layerId, { ...layer, ...patch } as ProjectLayer);
      return true;
    },
  );
  return { layers, addLayer, appendLayerTurn, updateLayer };
}

function renderSession(
  overrides: Partial<ReturnType<typeof makeMutations>> = {},
) {
  const mutations = { ...makeMutations(), ...overrides };
  const logger = { warn: vi.fn() };
  const rendered = renderHook(() =>
    usePlanningSession({
      projectId: "p1",
      addLayer: mutations.addLayer,
      appendLayerTurn: mutations.appendLayerTurn,
      updateLayer: mutations.updateLayer,
      model: "test-model",
      logger,
    }),
  );
  return { ...rendered, mutations, logger };
}

const CONVERGED_CRITIQUE = "Looks solid.\nVERDICT: CONVERGED";
const CONTINUE_CRITIQUE = "Needs work on ports.\nVERDICT: CONTINUE";

describe("usePlanningSession", () => {
  beforeEach(() => {
    scripts = [];
    requests = [];
    installFetch();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("start() creates the live layer, runs proposer→critic, and converges on an explicit verdict", async () => {
    scripts = [
      { kind: "reply", content: "Proposal v1" },
      { kind: "reply", content: CONVERGED_CRITIQUE },
    ];
    const { result, mutations } = renderSession();

    await act(async () => {
      await result.current.start("Build a todo app");
    });
    await waitFor(() =>
      assert.strictEqual(result.current.sessionState?.status, "converged"),
    );

    // Layer created with the live-session shape (awaited before the loop).
    assert.strictEqual(mutations.addLayer.mock.calls.length, 1);
    const [, createdLayer] = mutations.addLayer.mock.calls[0];
    assert.strictEqual(createdLayer.kind, "brainstorm");
    assert.match(createdLayer.title, /^Live session: Build a todo app/);
    assert.strictEqual(createdLayer.status, "proposing");
    assert.strictEqual(createdLayer.maxRounds, 4);
    assert.strictEqual(createdLayer.turns[0].role, "human");

    // Both model turns persisted with role/round AND the status transition
    // in the same write (atomic patch).
    const appended = mutations.appendLayerTurn.mock.calls;
    assert.strictEqual(appended.length, 2);
    assert.deepStrictEqual(
      appended.map((c) => [c[2].role, c[2].round, c[3].status]),
      [
        ["proposer", 1, "critiquing"],
        ["critic", 1, "converged"],
      ],
    );

    // The hook mirrors the persisted transcript (seed + 2 model turns).
    assert.strictEqual(result.current.turns.length, 3);
    assert.strictEqual(result.current.isRunning, false);
    assert.strictEqual(result.current.draft, null);

    // The seed lives in "## Brief" only — it must NOT be double-folded as a
    // "Human steering" note (the seed turn is turns[0], excluded from the
    // steering scan).
    assert.doesNotMatch(requests[0].message, /Human steering/);
  });

  it("start() resolves false and keeps no session when the layer create fails", async () => {
    const { result } = renderSession({
      addLayer: vi.fn(async () => null),
    });
    let started: boolean | undefined;
    await act(async () => {
      started = await result.current.start("Build a todo app");
    });
    assert.strictEqual(started, false);
    assert.strictEqual(result.current.sessionState, null);
    assert.strictEqual(result.current.activeLayerId, null);
    assert.strictEqual(requests.length, 0, "no model turn without a layer");
  });

  it("folds the seed and prior turns into each request; CONTINUE advances the round", async () => {
    scripts = [
      { kind: "reply", content: "Proposal v1" },
      { kind: "reply", content: CONTINUE_CRITIQUE },
      { kind: "reply", content: "Proposal v2" },
      { kind: "reply", content: CONVERGED_CRITIQUE },
    ];
    const { result } = renderSession();

    await act(async () => {
      await result.current.start("Build a todo app");
    });
    await waitFor(() =>
      assert.strictEqual(result.current.sessionState?.status, "converged"),
    );

    assert.strictEqual(requests.length, 4);
    assert.strictEqual(result.current.sessionState?.round, 2);
    // The revision request carries the seed, the latest proposal, and the
    // latest critique (the grounded fold, not raw history).
    const revisionRequest = requests[2].message;
    assert.match(revisionRequest, /Build a todo app/);
    assert.match(revisionRequest, /Proposal v1/);
    assert.match(revisionRequest, /Needs work on ports/);
    assert.match(revisionRequest, /Round 2 of 4/);
  });

  it("a critic reply without a verdict line is treated as CONTINUE and logged", async () => {
    scripts = [
      { kind: "reply", content: "Proposal v1" },
      { kind: "reply", content: "Some critique with no verdict line at all" },
      { kind: "reply", content: "Proposal v2" },
      { kind: "reply", content: CONVERGED_CRITIQUE },
    ];
    const { result, logger } = renderSession();

    await act(async () => {
      await result.current.start("seed");
    });
    await waitFor(() =>
      assert.strictEqual(result.current.sessionState?.status, "converged"),
    );
    assert.strictEqual(result.current.sessionState?.round, 2);
    assert.ok(
      logger.warn.mock.calls.some(([msg]) => /VERDICT/.test(String(msg))),
      "malformed verdict is logged, not silently swallowed",
    );
  });

  it("parks at awaiting-human (cap-reached) when the round cap is hit, and RESUME extends by one round", async () => {
    // 4 rounds × (proposal + CONTINUE critique) = 8 turns, all continuing.
    scripts = Array.from({ length: 4 }).flatMap((): Script[] => [
      { kind: "reply", content: "proposal" },
      { kind: "reply", content: CONTINUE_CRITIQUE },
    ]);
    const { result } = renderSession();

    await act(async () => {
      await result.current.start("seed");
    });
    await waitFor(() =>
      assert.strictEqual(result.current.sessionState?.status, "awaiting-human"),
    );
    assert.strictEqual(result.current.sessionState?.awaitReason, "cap-reached");
    assert.strictEqual(result.current.sessionState?.round, 4);
    assert.strictEqual(requests.length, 8, "no quota burned past the cap");

    // Explicit human extension: one more revision round.
    scripts = [
      { kind: "reply", content: "proposal v5" },
      { kind: "reply", content: CONVERGED_CRITIQUE },
    ];
    await act(async () => {
      await result.current.resume();
    });
    await waitFor(() =>
      assert.strictEqual(result.current.sessionState?.status, "converged"),
    );
    assert.strictEqual(result.current.sessionState?.round, 5);
  });

  it("a stream error parks the session at awaiting-human with the message — never a silent stall", async () => {
    scripts = [
      { kind: "reply", content: "Proposal v1" },
      { kind: "error-frame", message: "Daily quota exceeded" },
    ];
    const { result, mutations } = renderSession();

    await act(async () => {
      await result.current.start("seed");
    });
    await waitFor(() =>
      assert.strictEqual(result.current.sessionState?.status, "awaiting-human"),
    );
    assert.strictEqual(result.current.sessionState?.awaitReason, "error");
    assert.match(result.current.sessionState?.errorMessage ?? "", /quota/i);
    assert.strictEqual(result.current.isRunning, false);
    // The parked status is persisted so a reload can recover the session.
    const statusWrites = mutations.updateLayer.mock.calls.map(
      (c) => c[2].status,
    );
    assert.ok(statusWrites.includes("awaiting-human"));
  });

  it("an HTTP error response parks the session at awaiting-human with the status", async () => {
    scripts = [{ kind: "http-error", status: 429 }];
    const { result } = renderSession();

    await act(async () => {
      await result.current.start("seed");
    });
    await waitFor(() =>
      assert.strictEqual(result.current.sessionState?.status, "awaiting-human"),
    );
    assert.strictEqual(result.current.sessionState?.awaitReason, "error");
    assert.match(result.current.sessionState?.errorMessage ?? "", /429/);
  });

  it("a failed turn persist parks the session at awaiting-human", async () => {
    scripts = [{ kind: "reply", content: "Proposal v1" }];
    const { result } = renderSession({
      appendLayerTurn: vi.fn(async () => null),
    });

    await act(async () => {
      await result.current.start("seed");
    });
    await waitFor(() =>
      assert.strictEqual(result.current.sessionState?.status, "awaiting-human"),
    );
    assert.strictEqual(result.current.sessionState?.awaitReason, "error");
    assert.match(
      result.current.sessionState?.errorMessage ?? "",
      /could not be saved/,
    );
  });

  it("pause aborts the in-flight turn without persisting it; resume re-runs the interrupted role", async () => {
    scripts = [{ kind: "hang" }];
    const { result, mutations } = renderSession();

    await act(async () => {
      await result.current.start("seed");
    });
    await waitFor(() => assert.strictEqual(result.current.isRunning, true));

    await act(async () => {
      await result.current.pause();
    });
    assert.strictEqual(result.current.sessionState?.status, "awaiting-human");
    assert.strictEqual(result.current.sessionState?.awaitReason, "paused");
    assert.strictEqual(result.current.sessionState?.resumeStatus, "proposing");
    assert.strictEqual(result.current.isRunning, false);
    assert.strictEqual(result.current.draft, null);
    // The aborted stream persisted nothing.
    assert.strictEqual(mutations.appendLayerTurn.mock.calls.length, 0);

    scripts = [
      { kind: "reply", content: "Proposal v1" },
      { kind: "reply", content: CONVERGED_CRITIQUE },
    ];
    await act(async () => {
      await result.current.resume();
    });
    await waitFor(() =>
      assert.strictEqual(result.current.sessionState?.status, "converged"),
    );
  });

  it("pause during an in-flight turn persist reconciles the durable turn — no duplicate on resume", async () => {
    // The proposer turn's appendLayerTurn is gated so pause() can land while
    // the persist is in flight (the F2 race: the turn IS durable, so the
    // superseding action must apply it exactly once).
    const mutations = makeMutations();
    let releaseAppend!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseAppend = resolve;
    });
    const realAppend = mutations.appendLayerTurn;
    const gatedAppend = vi.fn(
      async (...args: Parameters<typeof realAppend>) => {
        await gate;
        return realAppend(...args);
      },
    );
    scripts = [{ kind: "reply", content: "Proposal v1" }];
    const { result } = renderSession({
      ...mutations,
      appendLayerTurn: gatedAppend,
    });

    await act(async () => {
      await result.current.start("seed");
    });
    await waitFor(() => assert.strictEqual(gatedAppend.mock.calls.length, 1));

    await act(async () => {
      const pausing = result.current.pause();
      releaseAppend();
      await pausing;
    });

    // The persisted proposal was reconciled into the transcript...
    assert.strictEqual(result.current.turns.length, 2);
    assert.strictEqual(result.current.turns[1].content, "Proposal v1");
    // ...and the park points at the CRITIC (the proposal is done).
    assert.strictEqual(result.current.sessionState?.status, "awaiting-human");
    assert.strictEqual(result.current.sessionState?.awaitReason, "paused");
    assert.strictEqual(result.current.sessionState?.resumeStatus, "critiquing");

    // Resume runs ONLY the critic — the proposer turn is not re-run.
    scripts = [{ kind: "reply", content: CONVERGED_CRITIQUE }];
    await act(async () => {
      await result.current.resume();
    });
    await waitFor(() =>
      assert.strictEqual(result.current.sessionState?.status, "converged"),
    );
    assert.strictEqual(gatedAppend.mock.calls.length, 2, "no duplicate turn");
    assert.strictEqual(requests.length, 2);
  });

  it("unmount aborts the in-flight stream and supersedes the loop (no zombie writes)", async () => {
    scripts = [{ kind: "hang" }];
    const mutations = makeMutations();
    const { result, unmount } = renderSession(mutations);

    await act(async () => {
      await result.current.start("seed");
    });
    await waitFor(() => assert.strictEqual(result.current.isRunning, true));
    assert.strictEqual(requests.length, 1);
    assert.strictEqual(requests[0].signal?.aborted, false);

    unmount();
    assert.strictEqual(
      requests[0].signal?.aborted,
      true,
      "teardown aborts the fetch",
    );
    // Allow the rejected stream promise to settle: the superseded loop must
    // not persist anything afterwards.
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(mutations.appendLayerTurn.mock.calls.length, 0);
  });

  it("logger defaults to console when none is injected (Q2: malformed verdict is logged)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    scripts = [
      { kind: "reply", content: "Proposal v1" },
      { kind: "reply", content: "critique without any verdict" },
      { kind: "reply", content: "Proposal v2" },
      { kind: "reply", content: CONVERGED_CRITIQUE },
    ];
    const mutations = makeMutations();
    const { result } = renderHook(() =>
      usePlanningSession({
        projectId: "p1",
        addLayer: mutations.addLayer,
        appendLayerTurn: mutations.appendLayerTurn,
        updateLayer: mutations.updateLayer,
        model: "test-model",
        // no logger injected — the real Plan-phase wiring passes none
      }),
    );
    await act(async () => {
      await result.current.start("seed");
    });
    await waitFor(() =>
      assert.strictEqual(result.current.sessionState?.status, "converged"),
    );
    assert.ok(
      warnSpy.mock.calls.some(([msg]) => /VERDICT/.test(String(msg))),
      "default logger is console",
    );
  });

  it("forceConverge stops the loop and lands on converged; end is terminal", async () => {
    scripts = [{ kind: "hang" }];
    const { result } = renderSession();

    await act(async () => {
      await result.current.start("seed");
    });
    await waitFor(() => assert.strictEqual(result.current.isRunning, true));

    await act(async () => {
      await result.current.forceConverge();
    });
    assert.strictEqual(result.current.sessionState?.status, "converged");
    assert.strictEqual(result.current.isRunning, false);

    await act(async () => {
      await result.current.end();
    });
    assert.strictEqual(result.current.sessionState?.status, "done");
  });

  it("addSteering persists a human turn that is folded into the next model request", async () => {
    scripts = [{ kind: "hang" }];
    const { result } = renderSession();
    await act(async () => {
      await result.current.start("seed");
    });
    await waitFor(() => assert.strictEqual(result.current.isRunning, true));
    await act(async () => {
      await result.current.pause();
    });

    let steered = false;
    await act(async () => {
      steered = await result.current.addSteering("Use event sourcing");
    });
    assert.strictEqual(steered, true, "durable append resolves true");
    assert.strictEqual(
      result.current.turns[result.current.turns.length - 1].content,
      "Use event sourcing",
    );

    scripts = [
      { kind: "reply", content: "Proposal honoring steering" },
      { kind: "reply", content: CONVERGED_CRITIQUE },
    ];
    await act(async () => {
      await result.current.resume();
    });
    await waitFor(() =>
      assert.strictEqual(result.current.sessionState?.status, "converged"),
    );
    // requests[0] was the hung turn; requests[1] is the resumed proposer turn.
    assert.match(requests[1].message, /Use event sourcing/);
    assert.match(requests[1].message, /Human steering/);
  });

  it("addSteering resolves false when the turn persist fails, and the turn is not mirrored", async () => {
    scripts = [{ kind: "hang" }];
    const { result, mutations } = renderSession();
    await act(async () => {
      await result.current.start("seed");
    });
    await waitFor(() => assert.strictEqual(result.current.isRunning, true));
    await act(async () => {
      await result.current.pause();
    });

    const turnsBefore = result.current.turns.length;
    mutations.appendLayerTurn.mockResolvedValueOnce(null);
    let steered = true;
    await act(async () => {
      steered = await result.current.addSteering("Use event sourcing");
    });
    // false = the caller must keep the composer draft (a swallowed failure
    // here silently discarded the typed steering note).
    assert.strictEqual(steered, false);
    assert.strictEqual(result.current.turns.length, turnsBefore);
  });

  it("attach() recovers an interrupted persisted session as awaiting-human (paused)", async () => {
    const interrupted: ProjectLayer = {
      id: "L9",
      kind: "brainstorm",
      title: "Live session: seed",
      createdAt: 1,
      updatedAt: 2,
      status: "critiquing",
      maxRounds: 4,
      turns: [
        { id: "t1", author: "You", content: "seed brief", role: "human" },
        {
          id: "t2",
          author: "Proposer",
          content: "p1",
          role: "proposer",
          round: 2,
        },
      ],
    };
    const { result } = renderSession();

    act(() => {
      result.current.attach(interrupted);
    });
    assert.strictEqual(result.current.activeLayerId, "L9");
    assert.strictEqual(result.current.sessionState?.status, "awaiting-human");
    assert.strictEqual(result.current.sessionState?.awaitReason, "paused");
    assert.strictEqual(result.current.sessionState?.resumeStatus, "critiquing");
    assert.strictEqual(result.current.sessionState?.round, 2);
    assert.strictEqual(result.current.seed, "seed brief");
    assert.strictEqual(result.current.turns.length, 2);
    assert.strictEqual(result.current.isRunning, false);
  });

  it("attach() + resume continues an interrupted session at its persisted round with the stored transcript folded", async () => {
    const interrupted: ProjectLayer = {
      id: "L9",
      kind: "brainstorm",
      title: "Live session: seed",
      createdAt: 1,
      updatedAt: 2,
      status: "critiquing",
      maxRounds: 4,
      turns: [
        { id: "t1", author: "You", content: "seed brief", role: "human" },
        {
          id: "t2",
          author: "Proposer",
          content: "Stored proposal p1",
          role: "proposer",
          round: 2,
        },
      ],
    };
    scripts = [{ kind: "reply", content: CONVERGED_CRITIQUE }];
    const { result, mutations } = renderSession();
    // The persisted layer exists in storage (attach never creates it).
    mutations.layers.set("L9", interrupted);

    act(() => {
      result.current.attach(interrupted);
    });
    await act(async () => {
      await result.current.resume();
    });
    await waitFor(() =>
      assert.strictEqual(result.current.sessionState?.status, "converged"),
    );

    // The single resumed turn is the CRITIC, at the persisted round, and its
    // fold carries the stored proposal — not a fresh round-1 restart.
    assert.strictEqual(requests.length, 1);
    assert.match(requests[0].message, /Stored proposal p1/);
    assert.match(requests[0].message, /Round 2 of 4/);
    assert.strictEqual(result.current.sessionState?.round, 2);
    const [, layerId, turn] = mutations.appendLayerTurn.mock.calls[0];
    assert.strictEqual(layerId, "L9");
    assert.strictEqual(turn.role, "critic");
    assert.strictEqual(turn.round, 2);
  });

  it("beginFinalize persists finalizing; reset detaches so a new session can start", async () => {
    scripts = [
      { kind: "reply", content: "Proposal v1" },
      { kind: "reply", content: CONVERGED_CRITIQUE },
    ];
    const { result, mutations } = renderSession();
    await act(async () => {
      await result.current.start("seed");
    });
    await waitFor(() =>
      assert.strictEqual(result.current.sessionState?.status, "converged"),
    );

    await act(async () => {
      await result.current.beginFinalize();
    });
    assert.strictEqual(result.current.sessionState?.status, "finalizing");
    assert.ok(
      mutations.updateLayer.mock.calls.some(
        (c) => c[2].status === "finalizing",
      ),
      "finalizing status persisted",
    );

    act(() => {
      result.current.reset();
    });
    assert.strictEqual(result.current.sessionState, null);
    assert.strictEqual(result.current.activeLayerId, null);
    assert.strictEqual(result.current.turns.length, 0);

    // The hook accepts a fresh start after reset (stateRef gate cleared).
    scripts = [
      { kind: "reply", content: "Proposal v1" },
      { kind: "reply", content: CONVERGED_CRITIQUE },
    ];
    await act(async () => {
      assert.strictEqual(await result.current.start("second seed"), true);
    });
    await waitFor(() =>
      assert.strictEqual(result.current.sessionState?.status, "converged"),
    );
    assert.strictEqual(mutations.addLayer.mock.calls.length, 2);
  });

  it("cancelFinalize returns to converged (review dismissed)", async () => {
    scripts = [
      { kind: "reply", content: "Proposal v1" },
      { kind: "reply", content: CONVERGED_CRITIQUE },
    ];
    const { result } = renderSession();
    await act(async () => {
      await result.current.start("seed");
    });
    await waitFor(() =>
      assert.strictEqual(result.current.sessionState?.status, "converged"),
    );
    await act(async () => {
      await result.current.beginFinalize();
    });
    await act(async () => {
      await result.current.cancelFinalize();
    });
    assert.strictEqual(result.current.sessionState?.status, "converged");
  });

  // ── The finalize seam (GOD-007 / item 8.6) ────────────────────────────────
  // The finalize/distill view-model moved OUT of this hook into
  // usePlanningFinalize (see usePlanningFinalize.test.ts). What stays here is
  // the seam the two hooks share: a ref-fresh snapshot for out-of-render
  // readers, and a counter announcing that the tracked session is void.

  it("readSession() reports the ref-fresh status, seed and transcript", async () => {
    scripts = [
      { kind: "reply", content: "Proposal v1" },
      { kind: "reply", content: CONVERGED_CRITIQUE },
    ];
    const { result } = renderSession();
    assert.strictEqual(
      result.current.readSession(),
      null,
      "no session tracked yet",
    );

    await act(async () => {
      await result.current.start("seed brief");
    });
    await waitFor(() =>
      assert.strictEqual(result.current.sessionState?.status, "converged"),
    );

    const snapshot = result.current.readSession();
    assert.ok(snapshot);
    assert.strictEqual(snapshot.status, "converged");
    assert.strictEqual(snapshot.seed, "seed brief");
    assert.deepStrictEqual(
      snapshot.turns.map((t) => t.content),
      ["seed brief", "Proposal v1", CONVERGED_CRITIQUE],
    );

    act(() => {
      result.current.reset();
    });
    assert.strictEqual(result.current.readSession(), null);
  });

  it("discardEpoch bumps on attach, end and reset — and on nothing else", async () => {
    scripts = [
      { kind: "reply", content: "Proposal v1" },
      { kind: "reply", content: CONVERGED_CRITIQUE },
    ];
    const { result } = renderSession();
    const initial = result.current.discardEpoch;

    await act(async () => {
      await result.current.start("seed");
    });
    await waitFor(() =>
      assert.strictEqual(result.current.sessionState?.status, "converged"),
    );

    // Control arm (anti-vacuity for the three bumps below): an epoch that
    // moved on ordinary control actions would satisfy every "it bumped"
    // assertion while wiping a live finalize review on each of them — exactly
    // the A2 lift this seam has to preserve.
    await act(async () => {
      await result.current.addSteering("more detail");
    });
    await act(async () => {
      await result.current.beginFinalize();
    });
    await act(async () => {
      await result.current.cancelFinalize();
    });
    await act(async () => {
      await result.current.forceConverge();
    });
    assert.strictEqual(
      result.current.discardEpoch,
      initial,
      "steering, finalize begin/cancel and force-converge keep the session tracked",
    );

    const beforeEnd = result.current.discardEpoch;
    await act(async () => {
      await result.current.end();
    });
    assert.ok(
      result.current.discardEpoch > beforeEnd,
      "end() discards the tracked session",
    );

    const beforeReset = result.current.discardEpoch;
    act(() => {
      result.current.reset();
    });
    assert.ok(
      result.current.discardEpoch > beforeReset,
      "reset() discards the tracked session",
    );

    const beforeAttach = result.current.discardEpoch;
    act(() => {
      result.current.attach({
        id: "L-other",
        kind: "brainstorm",
        title: "Another session",
        createdAt: 1,
        updatedAt: 2,
        status: "converged",
        turns: [{ id: "t1", author: "You", content: "other", role: "human" }],
      });
    });
    assert.ok(
      result.current.discardEpoch > beforeAttach,
      "attach() replaces the tracked session",
    );
  });
});
