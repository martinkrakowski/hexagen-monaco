import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
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
});
