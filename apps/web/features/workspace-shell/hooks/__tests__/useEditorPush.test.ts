// First tests for useEditorPush's persistCommitSha (ADR-0045 follow-up): the
// helper must stamp `githubLink.lastCommitSha` through the RECORD-level
// `updateProjectRecord` — not a loadProjects pre-read + whole-array
// saveProjects, which persisted a possibly-stale snapshot of every record and
// was the original lastCommitSha clobber. NotFound (project deleted mid-push)
// is a warn + no-op: the push itself succeeded.

import { describe, it, vi, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";

import { ProjectExportRecordProvider } from "@/contexts/ProjectExportRecordContext";
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
    /** Messages passed to logger.errorWithException (throwing-port arm). */
    loggedExceptions: [] as string[],
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
    errorWithException: (_e: unknown, message: string) => {
      state.loggedExceptions.push(message);
    },
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

/**
 * GOD-004: the connected link and the lastCommitSha write now belong to
 * ProjectExportRecordContext, so the hook is exercised inside the real
 * provider — the same one production mounts — rather than against a stub of
 * the collaborator whose behavior these persistence assertions are about.
 */
function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(
    ProjectExportRecordProvider,
    { projectId: "p1" },
    children,
  );
}

async function renderConnectedHook() {
  const onPushed = vi.fn();
  const rendered = renderHook(
    () =>
      useEditorPush({
        projectId: "p1",
        files: { "src/a.ts": "content" },
        unpushed: true,
        onPushed,
      }),
    { wrapper },
  );
  // The mount effect resolves the connected repo from the port (async).
  await waitFor(() => {
    assert.ok(rendered.result.current.connectedRepo, "repo resolved");
  });
  return { ...rendered, onPushed };
}

/** Shared per-test reset (both describes below). */
function resetHarness() {
  seedProjects();
  harness.state.loadCalls = 0;
  harness.state.saveCalls = 0;
  harness.state.updateCalls = [];
  harness.state.warns = [];
  harness.state.failWith = null;
  harness.state.rejectWith = null;
  harness.state.loggedExceptions = [];
  harness.postJson.mockReset();
  vi.spyOn(window, "open").mockImplementation(() => null);
}

describe("useEditorPush — record-level lastCommitSha persistence (ADR-0045 follow-up)", () => {
  beforeEach(() => {
    resetHarness();
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
      "Skipped persisting GitHub link — the saved project no longer exists",
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
      "Failed to persist GitHub link to saved project",
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
    assert.deepStrictEqual(harness.state.warns, []);
    assert.deepStrictEqual(harness.state.loggedExceptions, [
      "Failed to persist GitHub link to saved project",
    ]);
  });
});

// GH-publish PR-2: the failure arm is now code-driven via
// mapGithubPublishFailure — pushErrorCode carries only the snake_case HTTP
// vocabulary (workflow_scope_required / reauth_required); kebab-case writer
// codes forwarded by the route's 500 passthrough must never become actionable.
describe("useEditorPush — GitHub failure-code mapping", () => {
  beforeEach(() => {
    resetHarness();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("surfaces workflow_scope_required with the server message verbatim", async () => {
    const serverMessage =
      "GitHub rejected the push — the connected token is missing the workflow scope. Reconnect GitHub to grant it, then retry.";
    harness.postJson.mockResolvedValue({
      kind: "http-error",
      status: 403,
      message: serverMessage,
      code: "workflow_scope_required",
    });
    const { result } = await renderConnectedHook();

    await act(async () => {
      await (result.current.onPush as () => Promise<void>)();
    });

    assert.strictEqual(result.current.pushError, serverMessage);
    assert.strictEqual(result.current.pushErrorCode, "workflow_scope_required");
  });

  it("maps a coded reauth_required 401 to the session-expired copy", async () => {
    harness.postJson.mockResolvedValue({
      kind: "http-error",
      status: 401,
      message: "GitHub authentication required",
      code: "reauth_required",
    });
    const { result } = await renderConnectedHook();

    await act(async () => {
      await (result.current.onPush as () => Promise<void>)();
    });

    assert.strictEqual(
      result.current.pushError,
      "GitHub session expired — sign in again to push.",
    );
    assert.strictEqual(result.current.pushErrorCode, "reauth_required");
  });

  it("a codeless 401 keeps the legacy session-expired copy and still yields reauth_required", async () => {
    // Pins the deliberate fallback for responses that predate code bodies.
    harness.postJson.mockResolvedValue({
      kind: "http-error",
      status: 401,
      message: "Unauthorized",
    });
    const { result } = await renderConnectedHook();

    await act(async () => {
      await (result.current.onPush as () => Promise<void>)();
    });

    assert.strictEqual(
      result.current.pushError,
      "GitHub session expired — sign in again to push.",
    );
    assert.strictEqual(result.current.pushErrorCode, "reauth_required");
  });

  it("a kebab-case writer-code passthrough yields the raw message with NO actionable code", async () => {
    harness.postJson.mockResolvedValue({
      kind: "http-error",
      status: 500,
      message: "boom",
      code: "conflict",
    });
    const { result } = await renderConnectedHook();

    await act(async () => {
      await (result.current.onPush as () => Promise<void>)();
    });

    assert.strictEqual(result.current.pushError, "boom");
    assert.strictEqual(result.current.pushErrorCode, null);
  });

  it("pushErrorCode clears (alongside pushError) at the start of the next push", async () => {
    harness.postJson.mockResolvedValueOnce({
      kind: "http-error",
      status: 403,
      message: "scope missing",
      code: "workflow_scope_required",
    });
    const { result } = await renderConnectedHook();

    await act(async () => {
      await (result.current.onPush as () => Promise<void>)();
    });
    assert.strictEqual(result.current.pushErrorCode, "workflow_scope_required");

    // Hold the second push in-flight so the start-of-push reset is observable
    // before any result lands.
    let resolvePush!: (value: unknown) => void;
    harness.postJson.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePush = resolve;
        }),
    );
    let pending!: Promise<void>;
    await act(async () => {
      // Deliberately NOT awaited: the push must still be in-flight below.
      pending = (result.current.onPush as () => Promise<void>)();
    });

    assert.strictEqual(result.current.isPushing, true);
    assert.strictEqual(result.current.pushError, null);
    assert.strictEqual(result.current.pushErrorCode, null);

    await act(async () => {
      resolvePush({
        kind: "success",
        data: {
          success: true,
          commitSha: "sha-9",
          commitUrl: "https://github.com/me/r/commit/sha-9",
        },
      });
      await pending;
    });
    assert.strictEqual(result.current.isPushing, false);
  });
});
