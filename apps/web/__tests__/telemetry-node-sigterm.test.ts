import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  type SigtermProcessLike,
  installSigtermFlush,
} from "../lib/sigterm-flush";

// The SIGTERM handler extracted from `lib/telemetry.node.ts`: registering a
// SIGTERM listener disables Node's default exit, so the handler must exit
// 143 itself when it is the last listener — and only then.

/** Drain the microtask queue so `.then` continuations run before asserts. */
async function tick(times = 10): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

/** A fake process-like SIGTERM emitter; `emit()` fires the listeners once. */
interface FakeSigtermProcess extends SigtermProcessLike {
  emit: () => void;
  exit: Mock<(code?: number) => unknown>;
}

function fakeProcess(
  otherListeners: Array<() => void> = [],
): FakeSigtermProcess {
  const listeners = new Set<() => void>(otherListeners);
  return {
    once: (_event, listener) => {
      listeners.add(listener);
    },
    removeListener: (_event, listener) => {
      listeners.delete(listener);
    },
    listenerCount: () => listeners.size,
    exit: vi.fn<(code?: number) => unknown>(() => undefined),
    emit: () => {
      for (const listener of [...listeners]) listener();
    },
  };
}

describe("SIGTERM flush handler (telemetry.node)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("exits 143 after the flush when it is the only SIGTERM listener", async () => {
    const shutdown = vi.fn().mockResolvedValue(undefined);
    const target = fakeProcess();

    installSigtermFlush(target, shutdown);
    target.emit();

    await tick();
    expect(shutdown).toHaveBeenCalledTimes(1);
    // It removed itself: no listener remains after the signal.
    expect(target.listenerCount("SIGTERM")).toBe(0);
    // With the default exit disabled by the registration, it must exit
    // itself — 128 + 15 — or the process would hang forever.
    expect(target.exit).toHaveBeenCalledTimes(1);
    expect(target.exit).toHaveBeenCalledWith(143);
  });

  it("does not exit when another SIGTERM listener exists — Next's handler stays in charge", async () => {
    const next = vi.fn();
    const shutdown = vi.fn().mockResolvedValue(undefined);
    const target = fakeProcess([next]);

    installSigtermFlush(target, shutdown);
    target.emit();

    await tick();
    expect(next).toHaveBeenCalled();
    expect(shutdown).toHaveBeenCalledTimes(1);
    // Another listener owns the exit; ours must not call it.
    expect(target.exit).not.toHaveBeenCalled();
  });

  it("holds the 2 s flush cap and still exits 143 when shutdown never resolves", async () => {
    vi.useFakeTimers();
    const shutdown = vi.fn(() => new Promise<void>(() => undefined));
    const target = fakeProcess();

    installSigtermFlush(target, shutdown);
    target.emit();

    // Before the cap: flushed nothing yet, no exit.
    await vi.advanceTimersByTimeAsync(1999);
    expect(target.exit).not.toHaveBeenCalled();

    // At the cap the timer wins the race and the exit decision still runs.
    await vi.advanceTimersByTimeAsync(1);
    await tick();
    expect(target.exit).toHaveBeenCalledTimes(1);
    expect(target.exit).toHaveBeenCalledWith(143);
  });
});
