import { describe, it, vi, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { renderHook, act } from "@testing-library/react";
import type { EditorWorkspacePersistencePort } from "@hexagen/shared";

import { useEditorWorkspace } from "./useEditorWorkspace";

// A persistence double whose clearWorkspace the test can hold open, so a save
// scheduled during the discard window can be observed after the discard.
const harness = vi.hoisted(() => {
  const state = {
    saveCalls: 0,
    holdClear: false,
    resolveClear: null as null | (() => void),
  };
  const persistence: EditorWorkspacePersistencePort = {
    saveWorkspace: async () => {
      state.saveCalls += 1;
      return { success: true, value: undefined };
    },
    loadWorkspace: async () => ({ success: true, value: null }),
    clearWorkspace: async () => {
      if (state.holdClear) {
        await new Promise<void>((resolve) => {
          state.resolveClear = () => resolve();
        });
      }
      return { success: true, value: undefined };
    },
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

describe("useEditorWorkspace discard follow-up (h7 Item 1c)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    harness.state.saveCalls = 0;
    harness.state.holdClear = false;
    harness.state.resolveClear = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("an edit made while a discard is in flight does not save after the discard", async () => {
    const { result } = renderHook(() => useEditorWorkspace());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await result.current.setSessionId("sess-1");
    });

    // Hold the discard open so editing happens while clearWorkspace is awaited.
    harness.state.holdClear = true;

    harness.state.saveCalls = 0;
    let clearP: Promise<unknown>;
    await act(async () => {
      clearP = result.current.clearSession();
      await vi.advanceTimersByTimeAsync(0);
    });

    // Edit while the discard waits: the hook's own debounce must not be armed.
    await act(async () => {
      result.current.updateFile("a.ts", "hello");
    });

    // Release the discard and run the debounce window.
    await act(async () => {
      harness.state.resolveClear!();
      await clearP;
      await vi.advanceTimersByTimeAsync(500);
    });

    assert.equal(
      harness.state.saveCalls,
      0,
      "an edit made during a discard does not save after the discard",
    );
  });

  it("a discard that finishes after a newer session took over leaves that session alone", async () => {
    const { result } = renderHook(() => useEditorWorkspace());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await result.current.setSessionId("sess-1");
    });

    // Hold the discard open so a newer session can take over in the meantime.
    harness.state.holdClear = true;

    harness.state.saveCalls = 0;
    let clearP: Promise<unknown>;
    await act(async () => {
      clearP = result.current.clearSession();
      await vi.advanceTimersByTimeAsync(0);
    });

    // While the clear is in flight the user opens another project: the new
    // session takes over and loads (the double's load resolves null).
    await act(async () => {
      await result.current.setSessionId("sess-2");
    });

    // The new session's edit arms its own pending write.
    await act(async () => {
      result.current.updateFile("a.ts", "hello");
    });

    // Release the discard and run the debounce window.
    await act(async () => {
      harness.state.resolveClear!();
      await clearP;
      await vi.advanceTimersByTimeAsync(500);
    });

    assert.equal(
      harness.state.saveCalls,
      1,
      "the newer session's edit is saved despite the late discard",
    );
    const file = result.current.state.files.get("a.ts");
    assert.ok(file, "the newer session's state still holds the file");
    assert.equal(file.content, "hello");
  });
});
