import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import type { ChatMessage, GovernanceEntry } from "@hexagen/local-llm";
import { useGovernanceThreadStore } from "../stores/useGovernanceThreadStore";
import { useGovernanceThread } from "../hooks/governance-assistant/useGovernanceThread";

// `useGovernanceThread` calls `getChatPersistence()` from `@/lib/wire`. Replace
// that getter with a fake port whose methods are individual spies, so each
// test can branch on the key being read/written without touching IndexedDB.
const fakePort = vi.hoisted(() => ({
  loadGovernanceThread: vi.fn(),
  saveGovernanceThread: vi.fn(),
  clearGovernanceThread: vi.fn(),
}));

vi.mock("@/lib/wire", () => ({
  getChatPersistence: () => fakePort,
}));

const entry = (id: string, label = "q", answer = "a"): GovernanceEntry => ({
  id,
  questionLabel: label,
  answer,
});

const ok = { success: true as const, value: undefined };

describe("useGovernanceThread — legacy adoption", () => {
  beforeEach(() => {
    fakePort.loadGovernanceThread.mockReset();
    fakePort.saveGovernanceThread.mockReset();
    fakePort.clearGovernanceThread.mockReset();
    // The persist effect calls saveGovernanceThread(...).catch(...); a vi.fn
    // that returns undefined would throw on `.catch`, so give every method a
    // resolved default. Tests that need different behavior override it.
    fakePort.saveGovernanceThread.mockResolvedValue(ok);
    fakePort.clearGovernanceThread.mockResolvedValue(ok);
    useGovernanceThreadStore.getState().clearAllThreads();
  });

  it("adopts the unsaved source when the scoped thread is empty and unsaved has entries", async () => {
    const bare = "step:foo:q:bar";
    const scoped = `projA-${bare}`;
    const unsavedSource = `unsaved-${bare}`;
    // Stable refs so the load effect's [adoptionSources] dependency does not
    // re-run the effect on every render (it is useMemo'd in production).
    const sources = [unsavedSource, bare];
    const messages: ChatMessage[] = [];
    const adopted = entry("e1", "q", "a");

    fakePort.loadGovernanceThread.mockImplementation(async (key: string) =>
      key === scoped
        ? { success: true, value: [] }
        : key === unsavedSource
          ? { success: true, value: [adopted] }
          : { success: true, value: [] },
    );

    const { result } = renderHook(() =>
      useGovernanceThread({
        contextKey: scoped,
        adoptionSources: sources,
        messages,
        isStreaming: false,
      }),
    );

    await waitFor(() =>
      expect(useGovernanceThreadStore.getState().getThread(scoped)).toEqual([
        adopted,
      ]),
    );

    expect(fakePort.loadGovernanceThread).toHaveBeenCalledWith(scoped);
    expect(fakePort.loadGovernanceThread).toHaveBeenCalledWith(unsavedSource);
    expect(fakePort.saveGovernanceThread).toHaveBeenCalledWith(scoped, [
      adopted,
    ]);
    expect(fakePort.clearGovernanceThread).toHaveBeenCalledWith(unsavedSource);
    expect(result.current.threadLoaded).toBe(true);
    expect(result.current.threadLoadingRef.current).toBe(false);

    // Pin the order so the save assertion above can't be satisfied by the
    // persist effect: scoped load -> source load -> scoped save -> source clear.
    const loadCalls = fakePort.loadGovernanceThread.mock.invocationCallOrder;
    const saveCalls = fakePort.saveGovernanceThread.mock.invocationCallOrder;
    const clearCalls = fakePort.clearGovernanceThread.mock.invocationCallOrder;
    expect(loadCalls[0]).toBeLessThan(loadCalls[1]);
    expect(loadCalls[1]).toBeLessThan(saveCalls[0]);
    expect(saveCalls[0]).toBeLessThan(clearCalls[0]);
  });

  it("falls through to the bare source when the unsaved source is empty", async () => {
    const bare = "step:foo:q:bar";
    const scoped = `projA-${bare}`;
    const unsavedSource = `unsaved-${bare}`;
    const sources = [unsavedSource, bare];
    const messages: ChatMessage[] = [];
    const adopted = entry("e1", "q", "a");

    fakePort.loadGovernanceThread.mockImplementation(async (key: string) =>
      key === scoped
        ? { success: true, value: [] }
        : key === unsavedSource
          ? { success: true, value: [] }
          : key === bare
            ? { success: true, value: [adopted] }
            : { success: true, value: [] },
    );

    renderHook(() =>
      useGovernanceThread({
        contextKey: scoped,
        adoptionSources: sources,
        messages,
        isStreaming: false,
      }),
    );

    await waitFor(() =>
      expect(useGovernanceThreadStore.getState().getThread(scoped)).toEqual([
        adopted,
      ]),
    );

    expect(fakePort.loadGovernanceThread).toHaveBeenCalledWith(bare);
    expect(fakePort.clearGovernanceThread).toHaveBeenCalledWith(bare);
    expect(fakePort.clearGovernanceThread).not.toHaveBeenCalledWith(
      unsavedSource,
    );
  });

  it("when both sources have entries, adopts the unsaved source and leaves the bare key untouched", async () => {
    const bare = "step:foo:q:bar";
    const scoped = `projA-${bare}`;
    const unsavedSource = `unsaved-${bare}`;
    const sources = [unsavedSource, bare];
    const messages: ChatMessage[] = [];
    const fromUnsaved = entry("e1", "q", "a");
    const fromBare = entry("e2", "q", "b");

    fakePort.loadGovernanceThread.mockImplementation(async (key: string) =>
      key === scoped
        ? { success: true, value: [] }
        : key === unsavedSource
          ? { success: true, value: [fromUnsaved] }
          : key === bare
            ? { success: true, value: [fromBare] }
            : { success: true, value: [] },
    );

    renderHook(() =>
      useGovernanceThread({
        contextKey: scoped,
        adoptionSources: sources,
        messages,
        isStreaming: false,
      }),
    );

    await waitFor(() =>
      expect(useGovernanceThreadStore.getState().getThread(scoped)).toEqual([
        fromUnsaved,
      ]),
    );

    // The bare source was never read (unsaved won).
    expect(fakePort.loadGovernanceThread).not.toHaveBeenCalledWith(bare);
    expect(fakePort.clearGovernanceThread).not.toHaveBeenCalledWith(bare);
  });

  it("does not clear the source when the scoped save fails", async () => {
    const bare = "step:foo:q:bar";
    const scoped = `projA-${bare}`;
    const unsavedSource = `unsaved-${bare}`;
    const sources = [unsavedSource, bare];
    const messages: ChatMessage[] = [];
    const adopted = entry("e1", "q", "a");

    fakePort.loadGovernanceThread.mockImplementation(async (key: string) =>
      key === scoped
        ? { success: true, value: [] }
        : key === unsavedSource
          ? { success: true, value: [adopted] }
          : { success: true, value: [] },
    );
    fakePort.saveGovernanceThread.mockResolvedValue({
      success: false,
      error: new Error("scoped save failed"),
    });

    renderHook(() =>
      useGovernanceThread({
        contextKey: scoped,
        adoptionSources: sources,
        messages,
        isStreaming: false,
      }),
    );

    await waitFor(() =>
      expect(fakePort.saveGovernanceThread).toHaveBeenCalledWith(scoped, [
        adopted,
      ]),
    );

    expect(fakePort.clearGovernanceThread).not.toHaveBeenCalled();
    expect(useGovernanceThreadStore.getState().getThread(scoped)).toEqual([
      adopted,
    ]);
  });

  it("does not adopt when the scoped thread already has entries", async () => {
    const bare = "step:foo:q:bar";
    const scoped = `projA-${bare}`;
    const sources = [`unsaved-${bare}`, bare];
    const messages: ChatMessage[] = [];
    const existing = entry("e1", "q", "first");

    fakePort.loadGovernanceThread.mockImplementation(async (key: string) =>
      key === scoped
        ? { success: true, value: [existing] }
        : { success: true, value: [] },
    );

    renderHook(() =>
      useGovernanceThread({
        contextKey: scoped,
        adoptionSources: sources,
        messages,
        isStreaming: false,
      }),
    );

    await waitFor(() =>
      expect(useGovernanceThreadStore.getState().getThread(scoped)).toEqual([
        existing,
      ]),
    );

    expect(fakePort.loadGovernanceThread).toHaveBeenCalledTimes(1);
    expect(fakePort.clearGovernanceThread).not.toHaveBeenCalled();
  });

  it("never adopts when there are no adoption sources (unsaved scope)", async () => {
    const scoped = "unsaved-step:foo:q:bar";
    const sources: string[] = [];
    const messages: ChatMessage[] = [];

    fakePort.loadGovernanceThread.mockResolvedValue({
      success: true,
      value: [],
    });

    const { result } = renderHook(() =>
      useGovernanceThread({
        contextKey: scoped,
        adoptionSources: sources,
        messages,
        isStreaming: false,
      }),
    );

    await waitFor(() => expect(result.current.threadLoaded).toBe(true));

    expect(fakePort.loadGovernanceThread).toHaveBeenCalledTimes(1);
    expect(fakePort.loadGovernanceThread).toHaveBeenCalledWith(scoped);
    expect(fakePort.saveGovernanceThread).not.toHaveBeenCalled();
    expect(fakePort.clearGovernanceThread).not.toHaveBeenCalled();
    expect(useGovernanceThreadStore.getState().getThread(scoped)).toEqual([]);
  });

  it("a failed load still resolves to loaded with an empty thread", async () => {
    const scoped = "projA-step:foo:q:bar";
    const sources: string[] = [];
    const messages: ChatMessage[] = [];

    // The adapter never rejects — it returns Result.success:false, so test that
    // shape (the adapter's real failure mode) ends loaded on an empty thread.
    fakePort.loadGovernanceThread.mockResolvedValue({
      success: false,
      error: new Error("idb boom"),
    });

    const { result } = renderHook(() =>
      useGovernanceThread({
        contextKey: scoped,
        adoptionSources: sources,
        messages,
        isStreaming: false,
      }),
    );

    await waitFor(() => expect(result.current.threadLoaded).toBe(true));

    expect(result.current.threadLoadingRef.current).toBe(false);
    expect(useGovernanceThreadStore.getState().getThread(scoped)).toEqual([]);
    expect(fakePort.saveGovernanceThread).not.toHaveBeenCalled();
    expect(fakePort.clearGovernanceThread).not.toHaveBeenCalled();
  });

  it("a superseded load writes nothing (stale), and the load-complete signal does not fire again", async () => {
    const q1Key = "projA-q1";
    const q2Key = "projA-q2";
    const sources: string[] = [];
    const messages: ChatMessage[] = [];
    const entry2 = entry("e2", "q2", "a2");

    let resolveQ1:
      | ((value: { success: boolean; value: GovernanceEntry[] }) => void)
      | null = null;
    const q1Promise = new Promise<{
      success: boolean;
      value: GovernanceEntry[];
    }>((resolve) => {
      resolveQ1 = resolve;
    });

    fakePort.loadGovernanceThread.mockImplementation(async (key: string) =>
      key === q1Key ? q1Promise : { success: true, value: [entry2] },
    );
    fakePort.saveGovernanceThread.mockResolvedValue(ok);
    fakePort.clearGovernanceThread.mockResolvedValue(ok);

    const { result, rerender } = renderHook(
      (props) => useGovernanceThread(props),
      {
        initialProps: {
          contextKey: q1Key,
          adoptionSources: sources,
          messages,
          isStreaming: false,
        },
      },
    );

    // q1's load is still pending; swap to q2 whose load resolves at once.
    rerender({
      contextKey: q2Key,
      adoptionSources: sources,
      messages,
      isStreaming: false,
    });

    await waitFor(() =>
      expect(useGovernanceThreadStore.getState().getThread(q2Key)).toEqual([
        entry2,
      ]),
    );
    // q2's load completed once.
    expect(result.current.loadCompleteToken).toBe(1);

    // Release the superseded q1 load.
    resolveQ1!({ success: true, value: [entry("e1", "q1", "a1")] });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // q1's stale chain wrote nothing.
    expect(useGovernanceThreadStore.getState().getThread(q1Key)).toEqual([]);
    // The load-complete signal did not fire again from q1.
    expect(result.current.loadCompleteToken).toBe(1);
    expect(result.current.threadLoadingRef.current).toBe(false);
  });
});
