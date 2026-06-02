import { describe, it, mock } from "node:test";
import assert from "node:assert";
import { renderHook, act } from "@testing-library/react";

import {
  EditorGuardProvider,
  useEditorGuard,
} from "@/contexts/EditorGuardContext";

describe("EditorGuardContext", () => {
  it("defaults to no unsaved changes", () => {
    const { result } = renderHook(() => useEditorGuard(), {
      wrapper: EditorGuardProvider,
    });
    assert.strictEqual(result.current.hasUnsavedChanges, false);
  });

  it("reflects register(dirty) in hasUnsavedChanges", () => {
    const { result } = renderHook(() => useEditorGuard(), {
      wrapper: EditorGuardProvider,
    });

    act(() => {
      result.current.register(true, {
        save: async () => {},
        discard: () => {},
      });
    });
    assert.strictEqual(result.current.hasUnsavedChanges, true);

    act(() => {
      result.current.register(false, null);
    });
    assert.strictEqual(result.current.hasUnsavedChanges, false);
  });

  it("delegates save() and discard() to the registered editor handlers", async () => {
    const { result } = renderHook(() => useEditorGuard(), {
      wrapper: EditorGuardProvider,
    });
    const save = mock.fn(async () => {});
    const discard = mock.fn(() => {});

    act(() => {
      result.current.register(true, { save, discard });
    });

    await act(async () => {
      await result.current.save();
    });
    act(() => {
      result.current.discard();
    });

    assert.strictEqual(save.mock.callCount(), 1);
    assert.strictEqual(discard.mock.callCount(), 1);
  });

  it("save()/discard() are safe no-ops when no editor is registered", async () => {
    const { result } = renderHook(() => useEditorGuard(), {
      wrapper: EditorGuardProvider,
    });
    // No editor registered — must not throw.
    await act(async () => {
      await result.current.save();
    });
    act(() => {
      result.current.discard();
    });
    assert.strictEqual(result.current.hasUnsavedChanges, false);
  });
});
