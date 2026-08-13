// crypto is a getter-only global in Node, so stub it via vi.stubGlobal (a plain
// `global.crypto =` throws "has only a getter"). Textual position is cosmetic:
// Vitest hoists imports, so emptyFormValues' module-eval id is minted by the
// REAL crypto.randomUUID before this line runs — the stub only makes any ids
// minted at RUNTIME deterministic, and no assertion reads either batch.
let uuidCounter = 0;
vi.stubGlobal("crypto", {
  randomUUID: () => `uuid-${(uuidCounter += 1)}`,
} as unknown as Crypto);

import { describe, it, vi, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useForm } from "react-hook-form";
import type { ProjectConfig } from "@hexagen/project-configuration";
import { emptyFormValues } from "../../../project-wizard/config";
import {
  useProjectSettingsAutosave,
  PROJECT_SETTINGS_AUTOSAVE_DEBOUNCE_MS,
} from "../useProjectSettingsAutosave";

// Fake timers keep the debounce deterministic; flush/unmount/beforeunload are
// all synchronous, so no waitFor (which would hang under fake timers) is needed.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Mount the hook over a REAL react-hook-form instance so `watch` fires. */
function setup({
  projectId = "p1" as string | null,
  debounceMs,
}: { projectId?: string | null; debounceMs?: number } = {}) {
  const persist = vi.fn();
  const view = renderHook(() => {
    const form = useForm<ProjectConfig>({ defaultValues: emptyFormValues });
    const autosave = useProjectSettingsAutosave({
      projectId,
      form,
      persist,
      debounceMs,
    });
    return { form, autosave };
  });
  return { persist, view };
}

/** Convenience: the ProjectConfig captured by the Nth persist call. */
const persistedName = (persist: ReturnType<typeof vi.fn>, call = 0): string =>
  (persist.mock.calls[call][1] as ProjectConfig).governance.workspaceName;

describe("useProjectSettingsAutosave", () => {
  it("coalesces a burst of edits into a single persist after the debounce window", () => {
    const { persist, view } = setup();

    act(() => {
      view.result.current.form.setValue("governance.workspaceName", "a");
      view.result.current.form.setValue("governance.workspaceName", "ab");
      view.result.current.form.setValue("governance.workspaceName", "abc");
    });
    assert.strictEqual(
      persist.mock.calls.length,
      0,
      "nothing persists before the debounce elapses",
    );

    act(() => {
      vi.advanceTimersByTime(PROJECT_SETTINGS_AUTOSAVE_DEBOUNCE_MS);
    });
    assert.strictEqual(
      persist.mock.calls.length,
      1,
      "one write for the whole burst",
    );
    assert.strictEqual(persist.mock.calls[0][0], "p1");
    assert.strictEqual(
      persistedName(persist),
      "abc",
      "persists the latest values",
    );
  });

  it("restarts the debounce window on every edit — nothing fires at the FIRST edit's deadline while the user is still typing", () => {
    const { persist, view } = setup();

    // Timeline assumes the 500ms default window: edit@t0 arms t=500.
    act(() => {
      view.result.current.form.setValue("governance.workspaceName", "a");
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    // Second edit at t=300 must RESTART the window (deadline moves to t=800).
    act(() => {
      view.result.current.form.setValue("governance.workspaceName", "ab");
    });
    // t=550: past the first edit's t=500 deadline. A throttle (schedule only
    // when no timer is pending) or a dropped clearTimeout-restart would have
    // fired at t=500 — trailing-edge debounce has written nothing yet.
    act(() => {
      vi.advanceTimersByTime(250);
    });
    assert.strictEqual(
      persist.mock.calls.length,
      0,
      "mid-typing: the restarted window has not elapsed",
    );
    // t=800: one full quiet window after the LAST edit.
    act(() => {
      vi.advanceTimersByTime(250);
    });
    assert.strictEqual(
      persist.mock.calls.length,
      1,
      "exactly one write, debounceMs after the final keystroke",
    );
    assert.strictEqual(persistedName(persist), "ab");
  });

  it("flush() persists immediately, bypassing the debounce, and clears the pending timer (blur)", () => {
    const { persist, view } = setup();

    act(() => {
      view.result.current.form.setValue("governance.workspaceName", "blurred");
    });
    act(() => {
      view.result.current.autosave.flush();
    });

    assert.strictEqual(persist.mock.calls.length, 1, "flush writes at once");
    assert.strictEqual(persistedName(persist), "blurred");

    // The pending debounce timer was cleared — advancing it must not double-write.
    act(() => {
      vi.advanceTimersByTime(PROJECT_SETTINGS_AUTOSAVE_DEBOUNCE_MS);
    });
    assert.strictEqual(
      persist.mock.calls.length,
      1,
      "no duplicate write from the cleared timer",
    );
  });

  it("flushes a pending edit on unmount (a phase switch unmounts the plan host)", () => {
    const { persist, view } = setup();

    act(() => {
      view.result.current.form.setValue(
        "governance.workspaceName",
        "unmounted",
      );
    });
    assert.strictEqual(
      persist.mock.calls.length,
      0,
      "still within the debounce",
    );

    act(() => {
      view.unmount();
    });
    assert.strictEqual(
      persist.mock.calls.length,
      1,
      "the dirty edit is flushed before teardown",
    );
    assert.strictEqual(persistedName(persist), "unmounted");
  });

  it("flushes on beforeunload (best-effort tab close)", () => {
    const { persist, view } = setup();

    act(() => {
      view.result.current.form.setValue("governance.workspaceName", "closing");
    });
    act(() => {
      window.dispatchEvent(new Event("beforeunload"));
    });

    assert.strictEqual(persist.mock.calls.length, 1);
    assert.strictEqual(persistedName(persist), "closing");
  });

  it("ignores a programmatic reset (project load) — watch fires with name===undefined, no write", () => {
    const { persist, view } = setup();

    act(() => {
      view.result.current.form.reset({
        ...emptyFormValues,
        governance: { ...emptyFormValues.governance, workspaceName: "loaded" },
      });
    });
    act(() => {
      vi.advanceTimersByTime(PROJECT_SETTINGS_AUTOSAVE_DEBOUNCE_MS);
    });
    assert.strictEqual(
      persist.mock.calls.length,
      0,
      "a reset must not persist the just-loaded values back",
    );

    // ...and the form was never marked dirty, so an explicit flush is a no-op too.
    act(() => {
      view.result.current.autosave.flush();
    });
    assert.strictEqual(persist.mock.calls.length, 0);
  });

  it("a reset supersedes a PENDING edit — no surviving timer or flush ever persists the post-reset values", () => {
    const { persist, view } = setup();

    // A named edit is dirty and inside the debounce window…
    act(() => {
      view.result.current.form.setValue("governance.workspaceName", "typed");
    });
    assert.strictEqual(vi.getTimerCount(), 1, "the edit armed a timer");

    // …then a programmatic reset lands (Save & New persists the real values
    // via updateProject, then resets to empty). The pending edit must be
    // DROPPED: flush reads getValues() at fire time, so letting the timer
    // survive would persist the post-reset values over the just-saved state.
    act(() => {
      view.result.current.form.reset({
        ...emptyFormValues,
        governance: {
          ...emptyFormValues.governance,
          workspaceName: "post-reset",
        },
      });
    });
    assert.strictEqual(
      vi.getTimerCount(),
      0,
      "the reset cleared the pending debounce timer",
    );
    act(() => {
      vi.advanceTimersByTime(PROJECT_SETTINGS_AUTOSAVE_DEBOUNCE_MS);
    });
    assert.strictEqual(persist.mock.calls.length, 0);

    // The dirty flag was cleared too: neither an explicit (blur) flush nor the
    // unmount flush may write "post-reset" back.
    act(() => {
      view.result.current.autosave.flush();
    });
    assert.strictEqual(persist.mock.calls.length, 0);
    act(() => {
      view.unmount();
    });
    assert.strictEqual(
      persist.mock.calls.length,
      0,
      "the unmount flush has nothing to write after a reset",
    );
  });

  it("is disabled when projectId is null (genesis) — nothing is watched and flush no-ops", () => {
    const { persist, view } = setup({ projectId: null });

    act(() => {
      view.result.current.form.setValue("governance.workspaceName", "x");
    });
    // Pin the MECHANISM, not just the outcome: with no subscription there is
    // no debounce timer at all. (Without this, removing the subscription gate
    // alone would still pass — the flush id-guard backstops the persist count.)
    assert.strictEqual(
      vi.getTimerCount(),
      0,
      "no debounce timer is ever scheduled while projectId is null",
    );
    act(() => {
      vi.advanceTimersByTime(PROJECT_SETTINGS_AUTOSAVE_DEBOUNCE_MS);
    });
    assert.strictEqual(
      persist.mock.calls.length,
      0,
      "no field subscription while projectId is null",
    );

    act(() => {
      view.result.current.autosave.flush();
    });
    assert.strictEqual(
      persist.mock.calls.length,
      0,
      "flush cannot write without an id",
    );
  });

  it("honors a custom debounce window", () => {
    const { persist, view } = setup({ debounceMs: 1000 });

    act(() => {
      view.result.current.form.setValue("governance.workspaceName", "slow");
    });
    act(() => {
      vi.advanceTimersByTime(PROJECT_SETTINGS_AUTOSAVE_DEBOUNCE_MS);
    });
    assert.strictEqual(
      persist.mock.calls.length,
      0,
      "the default window is shorter than the custom one — no write yet",
    );

    act(() => {
      vi.advanceTimersByTime(1000 - PROJECT_SETTINGS_AUTOSAVE_DEBOUNCE_MS);
    });
    assert.strictEqual(persist.mock.calls.length, 1);
    assert.strictEqual(persistedName(persist), "slow");
  });

  // ── Boundary guard: in-place projectId switch ─────────────────────────────
  // No live UI performs an in-place A→B switch today (project load is a full
  // navigation/remount), but the hook guards the boundary pre-emptively — see
  // the cleanup comment in useProjectSettingsAutosave. These tests pin that a
  // pending edit belonging to A can never be persisted under B's id.

  /** Like setup(), but projectId is a rerenderable prop (the form instance
   * stays the same across the switch — exactly the hazard: it still holds A's
   * values when the id flips to B). */
  function setupSwitchable() {
    const persist = vi.fn();
    const view = renderHook(
      ({ projectId }: { projectId: string | null }) => {
        const form = useForm<ProjectConfig>({ defaultValues: emptyFormValues });
        const autosave = useProjectSettingsAutosave({
          projectId,
          form,
          persist,
        });
        return { form, autosave };
      },
      { initialProps: { projectId: "pA" as string | null } },
    );
    return { persist, view };
  }

  it("drops a pending edit on an in-place projectId switch — never cross-writes it to the new project", () => {
    const { persist, view } = setupSwitchable();

    // A dirty edit under pA, still inside the debounce window…
    act(() => {
      view.result.current.form.setValue("governance.workspaceName", "stale-A");
    });
    assert.strictEqual(persist.mock.calls.length, 0);

    // …then the id switches in place. The stale edit must be dropped: neither
    // the cleanup flush nor the surviving debounce timer may write it under pB.
    act(() => {
      view.rerender({ projectId: "pB" });
    });
    assert.strictEqual(
      persist.mock.calls.length,
      0,
      "the boundary cleanup must not flush A's edit under pB",
    );
    act(() => {
      vi.advanceTimersByTime(PROJECT_SETTINGS_AUTOSAVE_DEBOUNCE_MS);
    });
    assert.strictEqual(
      persist.mock.calls.length,
      0,
      "the pending debounce timer from pA was neutralized, not left to fire against pB",
    );
    // The dirty flag was cleared too — an explicit flush has nothing to write.
    act(() => {
      view.result.current.autosave.flush();
    });
    assert.strictEqual(persist.mock.calls.length, 0);

    // Autosave is fully live for pB afterwards: a fresh edit persists normally.
    act(() => {
      view.result.current.form.setValue("governance.workspaceName", "fresh-B");
    });
    act(() => {
      vi.advanceTimersByTime(PROJECT_SETTINGS_AUTOSAVE_DEBOUNCE_MS);
    });
    assert.strictEqual(persist.mock.calls.length, 1);
    assert.strictEqual(persist.mock.calls[0][0], "pB");
    assert.strictEqual(persistedName(persist), "fresh-B");
  });

  it("still flushes on unmount after a switch (the guard only drops STALE edits, not the unmount flush)", () => {
    const { persist, view } = setupSwitchable();

    act(() => {
      view.rerender({ projectId: "pB" });
    });
    act(() => {
      view.result.current.form.setValue("governance.workspaceName", "b-edit");
    });
    act(() => {
      view.unmount();
    });

    assert.strictEqual(persist.mock.calls.length, 1);
    assert.strictEqual(persist.mock.calls[0][0], "pB");
    assert.strictEqual(persistedName(persist), "b-edit");
  });
});
