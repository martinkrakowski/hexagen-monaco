import { describe, it, vi, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { renderHook, act } from "@testing-library/react";
import type { EditorWorkspacePersistencePort } from "@hexagen/shared";

import { useEditorWorkspace } from "./useEditorWorkspace";

// A persistence double whose loadWorkspace the test can hold open and whose
// result (or thrown error) the test can switch per scenario, so edits made
// during the conflict-reload window can be observed.
const harness = vi.hoisted(() => {
  const state = {
    saveCalls: 0,
    savedPayloads: [] as unknown[],
    loadCalls: 0,
    holdLoad: false,
    resolveLoad: null as null | (() => void),
    loadResult: { success: true, value: null } as unknown,
    throwLoad: false,
  };
  const persistence: EditorWorkspacePersistencePort = {
    saveWorkspace: async (_sessionId, workspace) => {
      state.saveCalls += 1;
      state.savedPayloads.push(workspace);
      return { success: true, value: undefined };
    },
    loadWorkspace: async () => {
      state.loadCalls += 1;
      if (state.throwLoad) throw new Error("load exploded");
      if (state.holdLoad) {
        await new Promise<void>((resolve) => {
          state.resolveLoad = () => resolve();
        });
      }
      return state.loadResult as never;
    },
    clearWorkspace: async () => ({ success: true, value: undefined }),
  };
  const logger = {
    warn: () => {},
    error: () => {},
    info: () => {},
    debug: () => {},
    errorWithException: () => {},
  };
  return { state, persistence, logger };
});

vi.mock("@/lib/wire", () => ({
  getEditorWorkspacePersistence: () => harness.persistence,
  getWizardPersistence: () => ({
    loadDraft: async () => ({ success: true, value: null }),
  }),
  getLogger: () => harness.logger,
  getMigrationReady: () => Promise.resolve(),
}));

function loadedWorkspace(content: string) {
  return {
    schemaVersion: 1,
    sessionId: "p1",
    updatedAt: Date.now(),
    selectedFileId: "a.ts",
    files: {
      "a.ts": {
        content,
        isNew: false,
        dirty: false,
        updatedAt: Date.now(),
      },
    },
    unpushed: false,
  };
}

describe("useEditorWorkspace reloadAfterConflict", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    harness.state.saveCalls = 0;
    harness.state.savedPayloads = [];
    harness.state.loadCalls = 0;
    harness.state.holdLoad = false;
    harness.state.resolveLoad = null;
    harness.state.loadResult = { success: true, value: null };
    harness.state.throwLoad = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function mountWithSession() {
    const { result } = renderHook(() => useEditorWorkspace());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await result.current.setSessionId("p1");
    });
    return result;
  }

  it("an edit before the reload does not save the edited content after the reload answers", async () => {
    const result = await mountWithSession();
    await act(async () => {
      result.current.updateFile("a.ts", "edited");
    });

    harness.state.holdLoad = true;
    harness.state.loadResult = {
      success: true,
      value: loadedWorkspace("loaded"),
    };
    let reloadP!: Promise<boolean>;
    await act(async () => {
      reloadP = result.current.reloadAfterConflict("p1");
      await vi.advanceTimersByTimeAsync(100);
    });

    await act(async () => {
      harness.state.resolveLoad!();
      await reloadP;
      await vi.advanceTimersByTimeAsync(1000);
    });

    assert.equal(await reloadP, true);
    assert.equal(
      harness.state.saveCalls,
      0,
      "no save may fire for the edited content during/after the conflict reload",
    );
    assert.ok(
      !harness.state.savedPayloads.some(
        (p) =>
          typeof p === "object" &&
          p !== null &&
          (p as { files?: Record<string, { content?: string }> }).files?.[
            "a.ts"
          ]?.content === "edited",
      ),
      "saveWorkspace was never called with the edited content",
    );
  });

  it("an edit made while the load is held open does not save after the load answers, and the state is the loaded copy", async () => {
    const result = await mountWithSession();
    await act(async () => {
      result.current.updateFile("a.ts", "before");
    });

    harness.state.holdLoad = true;
    harness.state.loadResult = {
      success: true,
      value: loadedWorkspace("loaded"),
    };
    let reloadP!: Promise<boolean>;
    await act(async () => {
      reloadP = result.current.reloadAfterConflict("p1");
      await vi.advanceTimersByTimeAsync(100);
    });

    // Edit while the load is out: no save may be scheduled.
    await act(async () => {
      result.current.updateFile("a.ts", "during");
    });

    // The load is still held open across the whole debounce window: without
    // the suspension guard the debounced write would fire here.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    assert.ok(
      !harness.state.savedPayloads.some(
        (p) =>
          typeof p === "object" &&
          p !== null &&
          (p as { files?: Record<string, { content?: string }> }).files?.[
            "a.ts"
          ]?.content === "during",
      ),
      "saveWorkspace was never called with the edit made while the load was out",
    );

    await act(async () => {
      harness.state.resolveLoad!();
      await reloadP;
      await vi.advanceTimersByTimeAsync(1000);
    });

    assert.equal(harness.state.saveCalls, 0);
    const file = result.current.state.files.get("a.ts");
    assert.ok(file, "the state holds the loaded file");
    assert.equal(file.content, "loaded");
  });

  it("a failed load returns false, keeps the edit, and saves nothing further", async () => {
    const result = await mountWithSession();
    await act(async () => {
      result.current.updateFile("a.ts", "edited");
    });

    harness.state.loadResult = {
      success: false,
      error: { message: "storage refused" },
    };
    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.reloadAfterConflict("p1");
      await vi.advanceTimersByTimeAsync(1000);
    });

    assert.equal(outcome, false, "a failed load returns false");
    const file = result.current.state.files.get("a.ts");
    assert.ok(file, "the state still holds the edit");
    assert.equal(file.content, "edited");

    harness.state.saveCalls = 0;
    await act(async () => {
      result.current.updateFile("a.ts", "edited again");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    assert.equal(
      harness.state.saveCalls,
      0,
      "after a failed load, edits still save nothing",
    );
  });

  it("after a failed load, a second successful reload returns true and the next edit saves exactly once", async () => {
    const result = await mountWithSession();
    await act(async () => {
      result.current.updateFile("a.ts", "edited");
    });

    harness.state.loadResult = {
      success: false,
      error: { message: "storage refused" },
    };
    await act(async () => {
      await result.current.reloadAfterConflict("p1");
    });

    harness.state.loadResult = {
      success: true,
      value: loadedWorkspace("loaded"),
    };
    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.reloadAfterConflict("p1");
      await vi.advanceTimersByTimeAsync(1000);
    });
    assert.equal(outcome, true, "a successful reload returns true");

    harness.state.saveCalls = 0;
    await act(async () => {
      result.current.updateFile("a.ts", "after reload");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    assert.equal(
      harness.state.saveCalls,
      1,
      "the next edit after a successful reload saves exactly once",
    );
    const payload = harness.state.savedPayloads[0] as {
      files: Record<string, { content: string }>;
    };
    assert.equal(payload.files["a.ts"].content, "after reload");
  });

  it("called with an id that is not the open session: returns true and does not load again", async () => {
    const result = await mountWithSession();
    const loadCallsBefore = harness.state.loadCalls;

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.reloadAfterConflict("p2");
    });

    assert.equal(outcome, true);
    assert.equal(
      harness.state.loadCalls,
      loadCallsBefore,
      "loadWorkspace is not called again for another session",
    );
  });

  it("a loadWorkspace that throws returns false and nothing is saved", async () => {
    const result = await mountWithSession();
    await act(async () => {
      result.current.updateFile("a.ts", "edited");
    });

    harness.state.throwLoad = true;
    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.reloadAfterConflict("p1");
      await vi.advanceTimersByTimeAsync(1000);
    });

    assert.equal(outcome, false, "a thrown load is treated as a failed load");
    assert.equal(harness.state.saveCalls, 0);
  });

  it("an update queued during the reload cannot save the copy that lost (markFileSaved)", async () => {
    const result = await mountWithSession();
    await act(async () => {
      result.current.updateFile("a.ts", "loser");
    });

    harness.state.holdLoad = true;
    harness.state.loadResult = {
      success: true,
      value: loadedWorkspace("fresh"),
    };
    let reloadP!: Promise<boolean>;
    await act(async () => {
      reloadP = result.current.reloadAfterConflict("p1");
      await vi.advanceTimersByTimeAsync(100);
    });

    await act(async () => {
      result.current.markFileSaved("a.ts");
      harness.state.resolveLoad!();
      await reloadP;
    });

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    assert.ok(
      !harness.state.savedPayloads.some(
        (p) =>
          typeof p === "object" &&
          p !== null &&
          (p as { files?: Record<string, { content?: string }> }).files?.[
            "a.ts"
          ]?.content === "loser",
      ),
      "saveWorkspace was never called with the pre-reload content",
    );
    const file = result.current.state.files.get("a.ts");
    assert.ok(file, "the state holds the loaded file");
    assert.equal(file.content, "fresh");
  });

  it("an update queued during the reload cannot save the copy that lost (updateFile)", async () => {
    const result = await mountWithSession();
    await act(async () => {
      result.current.updateFile("a.ts", "loser");
    });

    harness.state.holdLoad = true;
    harness.state.loadResult = {
      success: true,
      value: loadedWorkspace("fresh"),
    };
    let reloadP!: Promise<boolean>;
    await act(async () => {
      reloadP = result.current.reloadAfterConflict("p1");
      await vi.advanceTimersByTimeAsync(100);
    });

    await act(async () => {
      result.current.updateFile("a.ts", "loser-2");
      harness.state.resolveLoad!();
      await reloadP;
    });

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    assert.ok(
      !harness.state.savedPayloads.some(
        (p) =>
          typeof p === "object" &&
          p !== null &&
          (p as { files?: Record<string, { content?: string }> }).files?.[
            "a.ts"
          ]?.content === "loser-2",
      ),
      "saveWorkspace was never called with the pre-reload content",
    );
    const file = result.current.state.files.get("a.ts");
    assert.ok(file, "the state holds the loaded file");
    assert.equal(file.content, "fresh");
  });

  it("after the reload has committed, the next edit saves once, with the loaded copy plus the edit", async () => {
    const result = await mountWithSession();
    await act(async () => {
      result.current.updateFile("a.ts", "edited");
    });

    harness.state.holdLoad = true;
    harness.state.loadResult = {
      success: true,
      value: loadedWorkspace("loaded"),
    };
    let reloadP!: Promise<boolean>;
    await act(async () => {
      reloadP = result.current.reloadAfterConflict("p1");
      await vi.advanceTimersByTimeAsync(100);
    });

    await act(async () => {
      harness.state.resolveLoad!();
      await reloadP;
    });

    harness.state.saveCalls = 0;
    await act(async () => {
      result.current.updateFile("a.ts", "loaded+edit");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    assert.equal(
      harness.state.saveCalls,
      1,
      "the next edit saves exactly once",
    );
    const payload = harness.state.savedPayloads[0] as {
      files: Record<string, { content: string }>;
    };
    assert.equal(payload.files["a.ts"].content, "loaded+edit");
  });
});
