import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import type { GovernanceEntry } from "@hexagen/local-llm";
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

describe("useGovernanceThread — legacy adoption", () => {
  beforeEach(() => {
    fakePort.loadGovernanceThread.mockReset();
    fakePort.saveGovernanceThread.mockReset();
    fakePort.clearGovernanceThread.mockReset();
    // The persist effect calls saveGovernanceThread(...).catch(...); a vi.fn
    // that returns undefined would throw on `.catch`, so give every method a
    // resolved default. Tests that need different behavior override it.
    fakePort.saveGovernanceThread.mockResolvedValue({
      success: true,
      value: undefined,
    });
    fakePort.clearGovernanceThread.mockResolvedValue({
      success: true,
      value: undefined,
    });
    useGovernanceThreadStore.getState().clearAllThreads();
  });

  it("adopts a legacy thread when the scoped thread is empty and the legacy is not", async () => {
    const scoped = "projA-step:foo:q:bar";
    const legacy = "step:foo:q:bar";
    const adopted = entry("e1", "q", "a");

    fakePort.loadGovernanceThread.mockImplementation(async (key: string) =>
      key === scoped
        ? { success: true, value: [] }
        : key === legacy
          ? { success: true, value: [adopted] }
          : { success: true, value: [] },
    );
    fakePort.saveGovernanceThread.mockResolvedValue({
      success: true,
      value: undefined,
    });
    fakePort.clearGovernanceThread.mockResolvedValue({
      success: true,
      value: undefined,
    });

    const { result } = renderHook(() =>
      useGovernanceThread({
        contextKey: scoped,
        legacyContextKey: legacy,
        messages: [],
        isStreaming: false,
      }),
    );

    await waitFor(() =>
      expect(useGovernanceThreadStore.getState().getThread(scoped)).toEqual([
        adopted,
      ]),
    );

    expect(fakePort.loadGovernanceThread).toHaveBeenCalledWith(scoped);
    expect(fakePort.loadGovernanceThread).toHaveBeenCalledWith(legacy);
    expect(fakePort.saveGovernanceThread).toHaveBeenCalledWith(scoped, [
      adopted,
    ]);
    expect(fakePort.clearGovernanceThread).toHaveBeenCalledWith(legacy);
    expect(result.current.threadLoaded).toBe(true);
    expect(result.current.threadLoadingRef.current).toBe(false);
  });

  it("does not adopt when the scoped thread already has entries", async () => {
    const scoped = "projA-step:foo:q:bar";
    const legacy = "step:foo:q:bar";
    const existing = entry("e1", "q", "first");

    fakePort.loadGovernanceThread.mockImplementation(async (key: string) =>
      key === scoped
        ? { success: true, value: [existing] }
        : { success: true, value: [] },
    );

    renderHook(() =>
      useGovernanceThread({
        contextKey: scoped,
        legacyContextKey: legacy,
        messages: [],
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

  it("does not clear the legacy key when the scoped save fails", async () => {
    const scoped = "projA-step:foo:q:bar";
    const legacy = "step:foo:q:bar";
    const adopted = entry("e1", "q", "a");

    fakePort.loadGovernanceThread.mockImplementation(async (key: string) =>
      key === scoped
        ? { success: true, value: [] }
        : { success: true, value: [adopted] },
    );
    fakePort.saveGovernanceThread.mockResolvedValue({
      success: false,
      error: new Error("scoped save failed"),
    });

    renderHook(() =>
      useGovernanceThread({
        contextKey: scoped,
        legacyContextKey: legacy,
        messages: [],
        isStreaming: false,
      }),
    );

    await waitFor(() =>
      expect(fakePort.saveGovernanceThread).toHaveBeenCalledWith(scoped, [
        adopted,
      ]),
    );

    expect(fakePort.clearGovernanceThread).not.toHaveBeenCalled();
    // The thread is still visible in-memory even though the save failed.
    expect(useGovernanceThreadStore.getState().getThread(scoped)).toEqual([
      adopted,
    ]);
  });

  it("never adopts when there is no saved project (unsaved scope has no legacy key)", async () => {
    const scoped = "unsaved-step:foo:q:bar";

    fakePort.loadGovernanceThread.mockResolvedValue({
      success: true,
      value: [],
    });
    fakePort.saveGovernanceThread.mockResolvedValue({
      success: true,
      value: undefined,
    });
    fakePort.clearGovernanceThread.mockResolvedValue({
      success: true,
      value: undefined,
    });

    const { result } = renderHook(() =>
      useGovernanceThread({
        contextKey: scoped,
        legacyContextKey: null,
        messages: [],
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
    const legacy = "step:foo:q:bar";

    fakePort.loadGovernanceThread.mockRejectedValue(new Error("idb boom"));

    const { result } = renderHook(() =>
      useGovernanceThread({
        contextKey: scoped,
        legacyContextKey: legacy,
        messages: [],
        isStreaming: false,
      }),
    );

    await waitFor(() => expect(result.current.threadLoaded).toBe(true));

    expect(result.current.threadLoadingRef.current).toBe(false);
    expect(useGovernanceThreadStore.getState().getThread(scoped)).toEqual([]);
    expect(fakePort.saveGovernanceThread).not.toHaveBeenCalled();
    expect(fakePort.clearGovernanceThread).not.toHaveBeenCalled();
  });
});
