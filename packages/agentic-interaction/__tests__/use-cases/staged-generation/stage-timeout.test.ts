import { test, describe, mock } from "node:test";
import assert from "node:assert";
import {
  STAGE_ATTEMPT_TIMEOUT_MS,
  LARGE_OUTPUT_STAGE_TIMEOUT_MS,
  STAGE_STREAMING_TIMEOUT_MS,
  stageTimeoutError,
} from "../../../src/application/use-cases/staged-generation/stage-timeout";
import { ExecuteLooseSpecConversionUseCase } from "../../../src/application/use-cases/staged-generation/execute-loose-spec-conversion.use-case";
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

    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const useCase = new ExecuteLooseSpecConversionUseCase(mockLLMAdapter);
      const promise = useCase.execute("Build a core domain");
      mock.timers.tick(LARGE_OUTPUT_STAGE_TIMEOUT_MS);
      const result = await promise;

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.match((result.error as Error).message, /timed out/i);
      }
      assert.strictEqual(callCount, 1, "must not retry a timeout");
    } finally {
      mock.timers.reset();
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

    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const useCase = new ExecuteLooseSpecConversionUseCase(mockLLMAdapter);
      const promise = useCase.execute("Build a core domain");
      mock.timers.tick(LARGE_OUTPUT_STAGE_TIMEOUT_MS);
      const result = await promise;

      assert.strictEqual(result.success, false);
      if (!result.success) {
        // A deadline must surface as the actionable timeout message, distinct
        // from the bare "AbortError" used for an external user cancel.
        assert.match((result.error as Error).message, /timed out/i);
      }
      assert.strictEqual(callCount, 1, "must not retry a timeout");
    } finally {
      mock.timers.reset();
    }
  });
});
