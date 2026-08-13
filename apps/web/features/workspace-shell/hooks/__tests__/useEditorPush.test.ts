// First tests for useEditorPush's persistCommitSha (ADR-0045 follow-up): the
// helper must stamp `githubLink.lastCommitSha` through the RECORD-level
// `updateProjectRecord` — not a loadProjects pre-read + whole-array
// saveProjects, which persisted a possibly-stale snapshot of every record and
// was the original lastCommitSha clobber. NotFound (project deleted mid-push)
// is a warn + no-op: the push itself succeeded.

import { describe, it, vi, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";

import { useEditorPush } from "../useEditorPush";

// The hook's whole module graph besides React is these two modules, so full
// factories are safe (no transitive consumer needs the real wire.client DI).
const harness = vi.hoisted(() => {
  const state = {
    projects: [] as Array<Record<string, unknown>>,
    loadCalls: 0,
    saveCalls: 0,
    updateCalls: [] as string[],
    warns: [] as string[],
    /** When set, updateProjectRecord fails with this error instead of writing. */
    failWith: null as null | { kind: string; message: string },
    /** When set, updateProjectRecord REJECTS (throwing port) instead of writing. */
    rejectWith: null as null | Error,
  };
  const port = {
    loadProjects: async () => {
      state.loadCalls += 1;
      return { success: true as const, value: state.projects };
    },
    // Whole-array writer — must stay UNUSED by the hook (asserted per test).
    saveProjects: async () => {
      state.saveCalls += 1;
      return { success: true as const, value: undefined };
    },
    updateProjectRecord: async (
      id: string,
      updater: (p: Record<string, unknown>) => Record<string, unknown>,
    ) => {
      state.updateCalls.push(id);
      if (state.rejectWith) {
        throw state.rejectWith;
      }
      if (state.failWith) {
        return { success: false as const, error: state.failWith };
      }
      const index = state.projects.findIndex((p) => p.id === id);
      if (index === -1) {
        return {
          success: false as const,
          error: { kind: "NotFound", message: `No saved project ${id}` },
        };
      }
      const updated = updater(state.projects[index]);
      state.projects = state.projects.map((p, i) =>
        i === index ? updated : p,
      );
      return { success: true as const, value: updated };
    },
  };
  const logger = {
    warn: (message: string) => {
      state.warns.push(message);
    },
    error: () => {},
    info: () => {},
    debug: () => {},
    errorWithException: () => {},
  };
  const postJson = vi.fn();
  return { state, port, logger, postJson };
});

vi.mock("@/lib/wire.client", () => ({
  getSavedProjectsPersistence: () => harness.port,
  getLogger: () => harness.logger,
}));
vi.mock("@/lib/fetch-json", () => ({
  postJson: harness.postJson,
}));

const link = {
  owner: "me",
  repo: "r",
  branch: "main",
  defaultBranch: "main",
  lastCommitSha: null,
  htmlUrl: "https://github.com/me/r",
};

/** A sibling record whose identity must survive a push untouched. */
let sibling: Record<string, unknown>;

function seedProjects() {
  sibling = { id: "p2", name: "Other", githubLink: null, updatedAt: 1 };
  harness.state.projects = [
    { id: "p1", name: "Pushed", githubLink: { ...link }, updatedAt: 1 },
    sibling,
  ];
}

function mockPushOk(commitSha: string) {
  harness.postJson.mockResolvedValue({
    kind: "success",
    data: {
      success: true,
      commitSha,
      commitUrl: `https://github.com/me/r/commit/${commitSha}`,
    },
  });
}

async function renderConnectedHook() {
  const onPushed = vi.fn();
  const rendered = renderHook(() =>
    useEditorPush({
      projectId: "p1",
      files: { "src/a.ts": "content" },
      unpushed: true,
      onPushed,
    }),
  );
  // The mount effect resolves the connected repo from the port (async).
  await waitFor(() => {
    assert.ok(rendered.result.current.connectedRepo, "repo resolved");
  });
  return { ...rendered, onPushed };
}

describe("useEditorPush — record-level persistCommitSha (ADR-0045 follow-up)", () => {
  beforeEach(() => {
    seedProjects();
    harness.state.loadCalls = 0;
    harness.state.saveCalls = 0;
    harness.state.updateCalls = [];
    harness.state.warns = [];
    harness.state.failWith = null;
    harness.state.rejectWith = null;
    harness.postJson.mockReset();
    vi.spyOn(window, "open").mockImplementation(() => null);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("persists lastCommitSha through updateProjectRecord only — no whole-array save, no extra pre-read, siblings untouched", async () => {
    mockPushOk("sha-1");
    const { result, onPushed } = await renderConnectedHook();
    const loadCallsAfterMount = harness.state.loadCalls;

    await act(async () => {
      await (result.current.onPush as () => Promise<void>)();
    });

    assert.strictEqual(onPushed.mock.calls.length, 1);
    // Record-level write, addressed to the pushed project only.
    assert.deepStrictEqual(harness.state.updateCalls, ["p1"]);
    const stored = harness.state.projects.find((p) => p.id === "p1") as {
      githubLink: { lastCommitSha: string | null };
    };
    assert.strictEqual(stored.githubLink.lastCommitSha, "sha-1");
    // THE regression pins: the old code loadProjects-then-saveProjects'd the
    // whole array from a snapshot, clobbering concurrent writers.
    assert.strictEqual(harness.state.saveCalls, 0, "no whole-array write");
    assert.strictEqual(
      harness.state.loadCalls,
      loadCallsAfterMount,
      "the persist path adds no pre-read",
    );
    // Sibling record identity unchanged — the write never touched it.
    assert.strictEqual(harness.state.projects[1], sibling);
    assert.strictEqual(result.current.pushError, null);
  });

  it("NotFound (project deleted mid-push) → warn + no-op; the push itself still succeeds", async () => {
    mockPushOk("sha-2");
    const { result, onPushed } = await renderConnectedHook();
    harness.state.failWith = { kind: "NotFound", message: "gone" };

    await act(async () => {
      await (result.current.onPush as () => Promise<void>)();
    });

    // The push completed (unpushed cleared, no error surfaced to the toolbar).
    assert.strictEqual(onPushed.mock.calls.length, 1);
    assert.strictEqual(result.current.pushError, null);
    assert.deepStrictEqual(harness.state.warns, [
      "Skipped persisting commit sha — the saved project no longer exists",
    ]);
    assert.strictEqual(harness.state.saveCalls, 0);
  });

  it("a non-NotFound persistence failure warns without failing the push", async () => {
    mockPushOk("sha-3");
    const { result } = await renderConnectedHook();
    harness.state.failWith = { kind: "Unknown", message: "idb exploded" };

    await act(async () => {
      await (result.current.onPush as () => Promise<void>)();
    });

    assert.strictEqual(result.current.pushError, null);
    assert.deepStrictEqual(harness.state.warns, [
      "Failed to persist commit sha to saved project",
    ]);
  });

  it("a THROWING port is contained: the push still completes and opens the commit page", async () => {
    mockPushOk("sha-4");
    const { result, onPushed } = await renderConnectedHook();
    harness.state.rejectWith = new Error("adapter rejected");

    await act(async () => {
      await (result.current.onPush as () => Promise<void>)();
    });

    // The rejection must not escape handlePush (which has no catch arm): the
    // push completed, the successful-push tail ran, and the failure surfaced
    // only as the best-effort warn.
    assert.strictEqual(onPushed.mock.calls.length, 1);
    assert.strictEqual(result.current.pushError, null);
    assert.strictEqual(vi.mocked(window.open).mock.calls.length, 1);
    assert.deepStrictEqual(harness.state.warns, [
      "Failed to persist commit sha to saved project",
    ]);
  });
});
