import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import {
  act,
  cleanup,
  render,
  screen,
  fireEvent,
} from "@testing-library/react";
import type {
  EditorWorkspaceConflictPort,
  PendingWorkspaceConflict,
  Result,
  PersistenceError,
} from "@hexagen/shared";

const state = vi.hoisted(() => {
  const conflicts = new Map<string, PendingWorkspaceConflict>();
  const listeners = new Set<() => void>();
  const calls: string[] = [];
  let keepResult: Promise<Result<void, PersistenceError>> = Promise.resolve({
    success: true,
    value: undefined,
  });
  let useResult: Promise<Result<void, PersistenceError>> = Promise.resolve({
    success: true,
    value: undefined,
  });
  const port: EditorWorkspaceConflictPort = {
    getPendingConflict(sessionId) {
      const entry = conflicts.get(sessionId) ?? null;
      return entry ? { ...entry } : null;
    },
    getSyncPause() {
      return null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async keepThisDeviceCopy(sessionId) {
      calls.push(`keep:${sessionId}`);
      return keepResult;
    },
    async useOtherDeviceCopy(sessionId) {
      calls.push(`useOther:${sessionId}`);
      return useResult;
    },
    async listConflictBackups() {
      return { success: false, error: { kind: "Unknown", message: "unused" } };
    },
  };
  return {
    conflicts,
    listeners,
    calls,
    port,
    setKeepResult(result: Result<void, PersistenceError>) {
      keepResult = Promise.resolve(result);
    },
    setUseResult(result: Result<void, PersistenceError>) {
      useResult = Promise.resolve(result);
    },
  };
});

vi.mock("@/lib/wire", () => ({
  getEditorWorkspaceConflicts: () => state.port,
}));

import { WorkspaceConflictNotice } from "../WorkspaceConflictNotice";

const TITLE = "This project was changed on another device";
const KEEP_LABEL = "Keep this device's copy";
const USE_LABEL = "Use the other device's copy";

function conflictFor(id: string): PendingWorkspaceConflict {
  return { sessionId: id, where: "save", at: "2026-01-01T00:00:00Z" };
}

function renderNotice(
  projectId: string | null,
  onReload: (projectId: string) => Promise<boolean> = async () => true,
) {
  return render(
    <WorkspaceConflictNotice projectId={projectId} onReload={onReload} />,
  );
}

beforeEach(() => {
  state.conflicts.clear();
  state.calls.length = 0;
  state.listeners.clear();
  state.setKeepResult({ success: true, value: undefined });
  state.setUseResult({ success: true, value: undefined });
});

afterEach(() => {
  cleanup();
});

describe("WorkspaceConflictNotice", () => {
  it("(a) renders nothing when there is no conflict", () => {
    const { container } = renderNotice("p1");
    assert.equal(container.textContent, "");
    assert.throws(() => screen.getByText(TITLE));
  });

  it("(b) shows the title and both buttons for the open project only", () => {
    state.conflicts.set("p1", conflictFor("p1"));
    renderNotice("p1");
    assert.ok(screen.getByText(TITLE));
    assert.ok(screen.getByRole("button", { name: KEEP_LABEL }));
    assert.ok(screen.getByRole("button", { name: USE_LABEL }));
    cleanup();
    renderNotice("p2");
    assert.equal(document.querySelector("p")?.textContent ?? "", "");
    assert.throws(() => screen.getByText(TITLE));
  });

  it("(c) a conflict added after mount shows; removing it hides", () => {
    renderNotice("p1");
    assert.throws(() => screen.getByText(TITLE));
    act(() => {
      state.conflicts.set("p1", conflictFor("p1"));
      state.listeners.forEach((listener) => listener());
    });
    assert.ok(screen.getByText(TITLE));
    act(() => {
      state.conflicts.delete("p1");
      state.listeners.forEach((listener) => listener());
    });
    assert.throws(() => screen.getByText(TITLE));
  });

  it("(d) the alert has role status and nothing takes focus", () => {
    state.conflicts.set("p1", conflictFor("p1"));
    renderNotice("p1");
    assert.equal(screen.getByRole("status").getAttribute("role"), "status");
    assert.equal(document.activeElement, document.body);
  });

  it("(e) a choice opens the confirm step and makes no port call; Go back restores buttons and focus", () => {
    state.conflicts.set("p1", conflictFor("p1"));
    renderNotice("p1");
    fireEvent.click(screen.getByRole("button", { name: KEEP_LABEL }));
    assert.ok(screen.getByText("Replace the copy in your account?"));
    assert.deepEqual(state.calls, []);
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    assert.ok(screen.getByRole("button", { name: KEEP_LABEL }));
    assert.equal(document.activeElement?.textContent, KEEP_LABEL);
  });

  it("(f) confirming keep calls keepThisDeviceCopy once and never reloads", async () => {
    state.conflicts.set("p1", conflictFor("p1"));
    const onReload = vi.fn(async () => true);
    renderNotice("p1", onReload);
    fireEvent.click(screen.getByRole("button", { name: KEEP_LABEL }));
    fireEvent.click(
      screen.getByRole("button", { name: "Replace account copy" }),
    );
    await act(async () => {});
    assert.deepEqual(state.calls, ["keep:p1"]);
    assert.equal(onReload.mock.calls.length, 0);
  });

  it("(g) confirming use gives the order [useOther, reload]", async () => {
    state.conflicts.set("p1", conflictFor("p1"));
    const onReload = vi.fn(async () => {
      state.calls.push("reload");
      return true;
    });
    renderNotice("p1", onReload);
    fireEvent.click(screen.getByRole("button", { name: USE_LABEL }));
    fireEvent.click(
      screen.getByRole("button", { name: "Replace this device's copy" }),
    );
    await act(async () => {});
    assert.deepEqual(state.calls, ["useOther:p1", "reload"]);
  });

  it("(h) a failed useOtherDeviceCopy still calls onReload once and shows the failure alert", async () => {
    state.conflicts.set("p1", conflictFor("p1"));
    state.setUseResult({
      success: false,
      error: { kind: "Conflict", message: "gone" },
    });
    const onReload = vi.fn(async () => true);
    renderNotice("p1", onReload);
    fireEvent.click(screen.getByRole("button", { name: USE_LABEL }));
    fireEvent.click(
      screen.getByRole("button", { name: "Replace this device's copy" }),
    );
    await act(async () => {});
    assert.equal(onReload.mock.calls.length, 1);
    assert.ok(screen.getByText("Your choice could not be applied"));
  });

  it("(i) a failed reload keeps the alert until a later reload succeeds", async () => {
    state.conflicts.set("p1", conflictFor("p1"));
    let resolveReload: ((value: boolean) => void) | null = null;
    const onReload = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveReload = resolve;
        }),
    );
    renderNotice("p1", onReload);
    fireEvent.click(screen.getByRole("button", { name: USE_LABEL }));
    fireEvent.click(
      screen.getByRole("button", { name: "Replace this device's copy" }),
    );
    await act(async () => {});
    await act(async () => {
      resolveReload?.(false);
    });
    act(() => {
      state.conflicts.delete("p1");
      state.listeners.forEach((listener) => listener());
    });
    assert.ok(screen.getByText("The project could not be reloaded"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reload project" }));
      resolveReload?.(true);
    });
    assert.equal(onReload.mock.calls.length, 2);
    assert.throws(() => screen.getByText("The project could not be reloaded"));
  });

  it("(j) while a call is held open all buttons are disabled and a second click starts no second call", async () => {
    state.conflicts.set("p1", conflictFor("p1"));
    state.setUseResult(new Promise<Result<void, PersistenceError>>(() => {}));
    renderNotice("p1");
    fireEvent.click(screen.getByRole("button", { name: USE_LABEL }));
    const confirmButton = screen.getByRole("button", {
      name: "Replace this device's copy",
    });
    fireEvent.click(confirmButton);
    await act(async () => {});
    const buttons = screen.getAllByRole("button");
    assert.ok(buttons.length >= 2);
    for (const button of buttons) {
      assert.equal((button as HTMLButtonElement).disabled, true);
    }
    fireEvent.click(confirmButton);
    assert.equal(
      state.calls.filter((call) => call.startsWith("useOther:")).length,
      1,
    );
  });

  it("(k) Escape acts as Go back", () => {
    state.conflicts.set("p1", conflictFor("p1"));
    renderNotice("p1");
    fireEvent.click(screen.getByRole("button", { name: USE_LABEL }));
    assert.ok(screen.getByText("Replace the copy on this device?"));
    fireEvent.keyDown(screen.getByRole("status"), { key: "Escape" });
    assert.ok(screen.getByRole("button", { name: KEEP_LABEL }));
    assert.equal(document.activeElement?.textContent, USE_LABEL);
  });
});
