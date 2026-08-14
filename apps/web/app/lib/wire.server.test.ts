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

  it("still returns a stable singleton across two plain (cacheable) requests", () => {
    const first = getModifyArchitectureUseCase("in-memory");
    const second = getModifyArchitectureUseCase("in-memory");
    expect(second).toBe(first);
  });
});
