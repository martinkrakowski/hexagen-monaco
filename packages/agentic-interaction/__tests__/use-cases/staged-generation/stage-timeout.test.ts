import { test, describe, vi } from "vitest";
import assert from "node:assert";
import {
  STAGE_ATTEMPT_TIMEOUT_MS,
  LARGE_OUTPUT_STAGE_TIMEOUT_MS,
  STAGE_STREAMING_TIMEOUT_MS,
  stageTimeoutError,
} from "../../../src/application/use-cases/staged-generation/stage-timeout";
import { ExecuteLooseSpecConversionUseCase } from "../../../src/application/use-cases/staged-generation/execute-loose-spec-conversion.use-case";
import { ClassifyContextTypeUseCase } from "../../../src/application/use-cases/staged-generation/classify-context-type.use-case";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";

describe("stage-timeout constants", () => {
  // These are a deliberate, user-visible tuning knob (the import-hang fix).
  // Pin them so a value change is a conscious, reviewed edit, not a silent drift.
  test("short-output ceiling is 3 minutes", () => {
    assert.strictEqual(STAGE_ATTEMPT_TIMEOUT_MS, 180_000);
  });

  test("large-output ceiling is 8 minutes and exceeds the short one", () => {
    assert.strictEqual(LARGE_OUTPUT_STAGE_TIMEOUT_MS, 480_000);
    assert.ok(LARGE_OUTPUT_STAGE_TIMEOUT_MS > STAGE_ATTEMPT_TIMEOUT_MS);
  });

  test("streaming (port-mapping) ceiling is 2 minutes", () => {
    assert.strictEqual(STAGE_STREAMING_TIMEOUT_MS, 120_000);
  });

  test("stageTimeoutError reports the label and the ceiling in seconds", () => {
    const e = stageTimeoutError("Loose-spec conversion", 480_000);
    assert.ok(e instanceof Error);
    assert.match(e.message, /Loose-spec conversion/);
    assert.match(e.message, /480s/);
    assert.match(e.message, /timed out/i);
  });
});

describe("ExecuteLooseSpecConversionUseCase — fail-fast on timeout", () => {
  // A deadline abort surfaces from the adapter two ways: as a returned failure
  // (real adapters) or as a thrown AbortError (some paths/mocks). Both must fail
  // fast — return the timeout error WITHOUT consuming the retry budget, so the
  // generous large-output ceiling is a one-shot wait, never multiplied by N.

  test("returned-failure abort -> timeout error, no retry", async () => {
    let callCount = 0;
    const mockLLMAdapter = {
      sendRequest: (request: { signal: AbortSignal }) => {
        callCount++;
        return new Promise((resolve) => {
          request.signal.addEventListener(
            "abort",
            () =>
              resolve({ success: false, error: new Error("Request aborted") }),
            { once: true },
          );
        });
      },
    } as unknown as SendStructuredRequestPort;

    vi.useFakeTimers();
    try {
      const useCase = new ExecuteLooseSpecConversionUseCase(mockLLMAdapter);
      const promise = useCase.execute("Build a core domain");
      vi.advanceTimersByTime(LARGE_OUTPUT_STAGE_TIMEOUT_MS);
      const result = await promise;

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.match((result.error as Error).message, /timed out/i);
      }
      assert.strictEqual(callCount, 1, "must not retry a timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  test("thrown-AbortError deadline -> timeout error (not a bare cancel), no retry", async () => {
    let callCount = 0;
    const mockLLMAdapter = {
      sendRequest: (request: { signal: AbortSignal }) => {
        callCount++;
        return new Promise((_resolve, reject) => {
          request.signal.addEventListener(
            "abort",
            () => {
              const e = new Error("AbortError");
              e.name = "AbortError";
              reject(e);
            },
            { once: true },
          );
        });
      },
    } as unknown as SendStructuredRequestPort;

    vi.useFakeTimers();
    try {
      const useCase = new ExecuteLooseSpecConversionUseCase(mockLLMAdapter);
      const promise = useCase.execute("Build a core domain");
      vi.advanceTimersByTime(LARGE_OUTPUT_STAGE_TIMEOUT_MS);
      const result = await promise;

      assert.strictEqual(result.success, false);
      if (!result.success) {
        // A deadline must surface as the actionable timeout message, distinct
        // from the bare "AbortError" used for an external user cancel.
        assert.match((result.error as Error).message, /timed out/i);
      }
      assert.strictEqual(callCount, 1, "must not retry a timeout");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ClassifyContextTypeUseCase — fail-fast on timeout", () => {
  // Same contract as above, for the single-context classifier (issue #258,
  // rescoped): an internal STAGE_ATTEMPT_TIMEOUT_MS deadline composed with the
  // optional external signal. On the deadline the timeout error surfaces with
  // NO retry — the production caller (stage-2 low-confidence loop) fail-softs
  // to its heuristic classification, so retrying here would only stack waits.

  const context = { name: "OrderManagement", responsibility: "Manages orders" };

  test("deadline fires (returned-failure abort) -> timeout error, no retry", async () => {
    let callCount = 0;
    const mockLLMAdapter = {
      sendRequest: (request: { signal: AbortSignal }) => {
        callCount++;
        return new Promise((resolve) => {
          request.signal.addEventListener(
            "abort",
            () =>
              resolve({ success: false, error: new Error("Request aborted") }),
            { once: true },
          );
        });
      },
    } as unknown as SendStructuredRequestPort;

    vi.useFakeTimers();
    try {
      const useCase = new ClassifyContextTypeUseCase(mockLLMAdapter);
      const promise = useCase.execute(context);
      await vi.advanceTimersByTimeAsync(STAGE_ATTEMPT_TIMEOUT_MS);
      const result = await promise;

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.match((result.error as Error).message, /timed out/i);
        assert.match(
          (result.error as Error).message,
          /Context-type classification/,
        );
      }
      assert.strictEqual(callCount, 1, "must not retry a timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  test("deadline fires (thrown AbortError) -> timeout error, no retry", async () => {
    let callCount = 0;
    const mockLLMAdapter = {
      sendRequest: (request: { signal: AbortSignal }) => {
        callCount++;
        return new Promise((_resolve, reject) => {
          request.signal.addEventListener(
            "abort",
            () => {
              const e = new Error("AbortError");
              e.name = "AbortError";
              reject(e);
            },
            { once: true },
          );
        });
      },
    } as unknown as SendStructuredRequestPort;

    vi.useFakeTimers();
    try {
      const useCase = new ClassifyContextTypeUseCase(mockLLMAdapter);
      const promise = useCase.execute(context);
      await vi.advanceTimersByTimeAsync(STAGE_ATTEMPT_TIMEOUT_MS);
      const result = await promise;

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.match((result.error as Error).message, /timed out/i);
      }
      assert.strictEqual(callCount, 1, "must not retry a timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  test("completes under the deadline -> normal result, deadline timer cleaned up", async () => {
    const mockLLMAdapter = {
      sendRequest: () =>
        new Promise((resolve) => {
          // Resolve well under STAGE_ATTEMPT_TIMEOUT_MS.
          setTimeout(
            () =>
              resolve({
                success: true,
                value: {
                  content: '{"type":"core","reasoning":"Primary business"}',
                },
              }),
            1_000,
          );
        }),
    } as unknown as SendStructuredRequestPort;

    vi.useFakeTimers();
    try {
      const useCase = new ClassifyContextTypeUseCase(mockLLMAdapter);
      const promise = useCase.execute(context);
      await vi.advanceTimersByTimeAsync(1_000);
      const result = await promise;

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.type, "core");
        assert.strictEqual(result.reasoning, "Primary business");
      }
      // The internal deadline timer must be cleared once the call settles.
      assert.strictEqual(
        vi.getTimerCount(),
        0,
        "deadline timer must be cleared",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test("external signal aborts early -> external abort wins over the deadline", async () => {
    const mockLLMAdapter = {
      sendRequest: (request: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          request.signal.addEventListener(
            "abort",
            () => {
              const e = new Error("AbortError");
              e.name = "AbortError";
              reject(e);
            },
            { once: true },
          );
        }),
    } as unknown as SendStructuredRequestPort;

    vi.useFakeTimers();
    try {
      const external = new AbortController();
      const useCase = new ClassifyContextTypeUseCase(mockLLMAdapter);
      const promise = useCase.execute(context, undefined, external.signal);
      // Cancel long before the internal deadline would fire.
      await vi.advanceTimersByTimeAsync(5_000);
      external.abort();
      const result = await promise;

      assert.strictEqual(result.success, false);
      if (!result.success) {
        // A caller cancel must surface as the bare abort, NOT be rebranded
        // as the deadline timeout.
        assert.strictEqual((result.error as Error).name, "AbortError");
        assert.doesNotMatch((result.error as Error).message, /timed out/i);
      }
      assert.strictEqual(
        vi.getTimerCount(),
        0,
        "deadline timer must be cleared",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test("adapter settles an external abort after the deadline -> still a cancel, not a timeout", async () => {
    // Regression: the deadline timer must die WITH the external cancel. If it
    // survived the cancel, it would flip `isTimedOut` while the adapter is
    // still winding down and rebrand the caller's cancel as the deadline
    // timeout.
    const mockLLMAdapter = {
      sendRequest: (request: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          request.signal.addEventListener(
            "abort",
            () => {
              // Settle the abort only AFTER the (now-dead) deadline would
              // have fired.
              setTimeout(() => {
                const e = new Error("AbortError");
                e.name = "AbortError";
                reject(e);
              }, STAGE_ATTEMPT_TIMEOUT_MS + 30_000);
            },
            { once: true },
          );
        }),
    } as unknown as SendStructuredRequestPort;

    vi.useFakeTimers();
    try {
      const external = new AbortController();
      const useCase = new ClassifyContextTypeUseCase(mockLLMAdapter);
      const promise = useCase.execute(context, undefined, external.signal);
      await vi.advanceTimersByTimeAsync(5_000);
      external.abort();
      // Cross the original deadline and reach the adapter's late settle.
      await vi.advanceTimersByTimeAsync(STAGE_ATTEMPT_TIMEOUT_MS + 30_000);
      const result = await promise;

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.strictEqual((result.error as Error).name, "AbortError");
        assert.doesNotMatch((result.error as Error).message, /timed out/i);
      }
      assert.strictEqual(
        vi.getTimerCount(),
        0,
        "no timer may survive the settle",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
