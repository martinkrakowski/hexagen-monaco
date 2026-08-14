import { afterEach, describe, expect, it } from "vitest";
import {
  clearModifyArchitectureCache,
  getModifyArchitectureUseCase,
} from "./wire.server";

describe("getModifyArchitectureUseCase caching", () => {
  afterEach(() => clearModifyArchitectureCache());

  it("never caches a signal/callback-wired (SSE) instance: a plain request after a stream request gets a fresh, un-poisoned instance", () => {
    // 1. Simulate an SSE /modify/stream request: signal + step callbacks wired in.
    const controller = new AbortController();
    const streamInstance = getModifyArchitectureUseCase(
      "in-memory",
      controller.signal,
      {
        onStepRunning: () => {},
        onStepComplete: () => {},
      },
    );
    // Stream finished / client disconnected -> its abort signal fires.
    controller.abort();

    // 2. A later plain /modify request wires no signal and no callbacks.
    const plainInstance = getModifyArchitectureUseCase("in-memory");

    // The plain request must NOT be handed the SSE-wired instance carrying an
    // already-fired abort signal + closed-stream callbacks.
    expect(plainInstance).not.toBe(streamInstance);
  });

  // The two cases below exercise each request-scoped input in isolation. The
  // combined case above alone cannot distinguish the correct write guard
  // (`!callbacks && !signal` — bypass the cache if EITHER is present) from a
  // buggy `!(callbacks && signal)` that would only bypass when BOTH are present
  // and thus still cache — and mis-serve — a signal-only or callbacks-only
  // instance. These pin the guard to the OR-of-either semantics.
  it("never caches a signal-only (cancellable) instance", () => {
    const signalInstance = getModifyArchitectureUseCase(
      "in-memory",
      new AbortController().signal,
    );
    const plainInstance = getModifyArchitectureUseCase("in-memory");

    expect(plainInstance).not.toBe(signalInstance);
  });

  it("never caches a callbacks-only instance", () => {
    const callbackInstance = getModifyArchitectureUseCase(
      "in-memory",
      undefined,
      { onStepRunning: () => {} },
    );
    const plainInstance = getModifyArchitectureUseCase("in-memory");

    expect(plainInstance).not.toBe(callbackInstance);
  });

  it("still returns a stable singleton across two plain (cacheable) requests", () => {
    const first = getModifyArchitectureUseCase("in-memory");
    const second = getModifyArchitectureUseCase("in-memory");
    expect(second).toBe(first);
  });
});
