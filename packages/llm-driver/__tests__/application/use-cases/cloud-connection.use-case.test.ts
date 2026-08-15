import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";

import type { Result } from "@hexagen/shared";
import type { VaultError } from "@hexagen/agentic-interaction";

import {
  createCloudConnectionUseCaseWithRetry,
  scheduleRetry,
  type CloudConnectionResult,
  type CloudConnectionUseCaseDependencies,
} from "../../../src/application/use-cases/cloud-connection.use-case.js";
import { MAX_RETRY_ATTEMPTS } from "../../../src/domain/services/cloud-connection-state-machine.js";

/**
 * A CloudKeyRetrievalPort double whose `retrieve()` always fails, counting each
 * call. The retry wrapper drives it once per attempt, so the call count is the
 * observable attempt count.
 */
function countingFailingVault(): {
  deps: CloudConnectionUseCaseDependencies;
  calls: () => number;
} {
  let calls = 0;
  const error: VaultError = { kind: "vault_locked", message: "vault locked" };
  const deps: CloudConnectionUseCaseDependencies = {
    vault: {
      retrieve: async (): Promise<Result<string, VaultError>> => {
        calls += 1;
        return { success: false, error };
      },
    },
  };
  return { deps, calls: () => calls };
}

describe("createCloudConnectionUseCaseWithRetry — bounded termination", () => {
  it("terminates after MAX_RETRY_ATTEMPTS+1 attempts and never hangs on a persistently-failing vault", async () => {
    // Fake timers so the exponential backoff (1s, 2s, 4s) resolves instantly and
    // deterministically instead of waiting real seconds — a genuine hang would
    // still be caught because runAllTimersAsync drains every scheduled timer and
    // the awaited promise below would never settle.
    vi.useFakeTimers();
    try {
      const { deps, calls } = countingFailingVault();

      const run = createCloudConnectionUseCaseWithRetry(deps)(
        { provider: "openai", model: "gpt-4o" },
        0,
      );

      // Drain the backoff timers; then the recursion (and thus `run`) settles.
      await vi.runAllTimersAsync();
      const result: CloudConnectionResult = await run;

      // Bounded: initial attempt + MAX_RETRY_ATTEMPTS retries. If the cap were
      // removed/loosened this would exceed the bound (or never settle).
      assert.equal(calls(), MAX_RETRY_ATTEMPTS + 1);
      assert.equal(result.success, false);
      assert.equal(result.error?.retryCount, MAX_RETRY_ATTEMPTS);
      // At the cap the surfaced error is no longer retryable — the chain stopped.
      assert.equal(result.error?.retryable, false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("scheduleRetry — a synchronous throw in the recursion rejects, never strands", () => {
  it("rejects (does not hang) when `recurse` throws synchronously", async () => {
    vi.useFakeTimers();
    try {
      let recurseCalls = 0;
      const boom = new Error("synchronous construction failure");

      // The pre-fix inline form — new Promise((resolve) =>
      // setTimeout(() => resolve(recurse()))) — has no reject path: this sync
      // throw would leave the Promise pending forever. The fixed scheduleRetry
      // awaits only the timer and `return recurse()`, so the throw becomes a
      // rejection of the returned Promise.
      const settled = scheduleRetry<never>(1000, () => {
        recurseCalls += 1;
        throw boom;
      });

      // Attach the rejection expectation BEFORE draining timers. `settled`
      // settles mid-drain (the timer fires, then `recurse` throws); calling
      // assert.rejects now registers a handler synchronously so the rejection
      // is never momentarily unhandled — otherwise Node emits an
      // unhandled-rejection warning that fails the run under Vitest.
      const rejection = assert.rejects(settled, (err: unknown) => {
        assert.equal(err, boom);
        return true;
      });

      await vi.runAllTimersAsync();
      await rejection;
      assert.equal(recurseCalls, 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("adopts the recursion's async rejection", async () => {
    vi.useFakeTimers();
    try {
      const boom = new Error("async failure");
      const settled = scheduleRetry<never>(1000, async () => {
        throw boom;
      });

      // Attach before draining — same reason as the synchronous-throw case.
      const rejection = assert.rejects(settled, (err: unknown) => {
        assert.equal(err, boom);
        return true;
      });

      await vi.runAllTimersAsync();
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});
