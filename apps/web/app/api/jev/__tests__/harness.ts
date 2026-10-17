// @vitest-environment node
/**
 * Shared test harness for the J5b route suites (report, review).
 *
 * Only the non-`vi.mock` pieces live here: the mock registry, the seeded
 * store helper, the reviewer-sub constant and the authorize helper. The
 * `vi.mock` calls themselves stay in each test file — vi.mock is hoisted per
 * file, and a factory must not reach across files for its mocks; the
 * factories here only close over `tracker`, which this module creates with
 * `vi.hoisted` so it exists before any factory runs.
 */
import { vi } from "vitest";
import type { DecisionReceiptsStore } from "../../../../lib/platform/decision-receipts-store";

export const REVIEWER_SUB = "reviewer-sub";

/**
 * The mocked boundaries both route suites swap per test. A plain module-level
 * object (no vi.hoisted — that transform only applies inside a test file):
 * the per-file `vi.mock` factories close over this import, and they only run
 * when the mocked module is first required, i.e. at the test file's
 * `await import("../route")`, which is after this module has initialized.
 */
export const tracker = {
  // Swapped per test: a fake store (gate cases) or the real seeded store.
  getStore: vi.fn<() => { decisionReceipts: unknown }>(),
  createJevDecisionAdvice: vi.fn<() => unknown>(),
  getToken: vi.fn<() => Promise<{ sub?: string } | null>>(),
};

/** The `beforeEach` reset both suites share. */
export function resetTracker(): void {
  tracker.createJevDecisionAdvice.mockReset().mockReturnValue(null);
  tracker.getToken.mockReset().mockResolvedValue(null);
  tracker.getStore.mockReset();
  delete process.env.JEV_REVIEWER_SUB;
  delete process.env.JEV_CONTEXT_TYPE_MIN_CONFIDENCE;
}

const openBackends: Array<() => Promise<void>> = [];

/** Close every backend `seededStore` opened; the `afterEach` of both suites. */
export async function closeOpenBackends(): Promise<void> {
  while (openBackends.length > 0) {
    await openBackends.pop()!();
  }
}

/** The real store on a sqlite backend, seeded per case, tracked for close. */
export async function seededStore(): Promise<{
  store: DecisionReceiptsStore;
  close: () => Promise<void>;
}> {
  const { openBackend } =
    await import("../../../../test-support/platform-backends");
  const { createDecisionReceiptsStore } =
    await import("../../../../lib/platform/decision-receipts-store");
  const backend = await openBackend("sqlite");
  openBackends.push(() => backend.close());
  return {
    store: createDecisionReceiptsStore(backend.db),
    close: () => backend.close(),
  };
}

/** The reviewer gate passes: the env sub is set and the token carries it. */
export function authorize(): void {
  process.env.JEV_REVIEWER_SUB = REVIEWER_SUB;
  tracker.getToken.mockResolvedValue({ sub: REVIEWER_SUB });
}
