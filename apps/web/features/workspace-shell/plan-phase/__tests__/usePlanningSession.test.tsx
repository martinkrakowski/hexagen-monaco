import { describe, it, vi, beforeEach, afterEach } from "vitest";
import assert from "node:assert";
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
let requests: Array<{ message: string }> = [];

function installFetch() {
  global.fetch = vi.fn(
    async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body));
      requests.push({ message: body.messages[0].content });
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
  const addLayer = vi.fn(async (_projectId: string, layer: unknown) => {
    const id = `layer-${++nextId}`;
    const l = layer as Omit<ProjectLayer, "id" | "createdAt" | "updatedAt">;
    layers.set(id, { ...l, id, createdAt: 1, updatedAt: 1 } as ProjectLayer);
    return id;
  });
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
      layers.set(layerId, {
        ...layer,
        ...patch,
        turns: [...layer.turns, { ...turn, id, at: Date.now() }],
      } as ProjectLayer);
      return id;
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

    await act(async () => {
      await result.current.addSteering("Use event sourcing");
    });
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

  it("completeFinalize stamps the produced-manifest link in the same write as the done status", async () => {
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

    await act(async () => {
      await result.current.completeFinalize();
    });
    assert.strictEqual(result.current.sessionState?.status, "done");
    const doneWrite = mutations.updateLayer.mock.calls.find(
      (c) => c[2].status === "done",
    );
    assert.ok(doneWrite, "terminal status persisted");
    assert.strictEqual(doneWrite![2].link.type, "produced-manifest");
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
});
