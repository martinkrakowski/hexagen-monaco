import { checkBudget } from "@hexagen/agentic-interaction";
import type {
  DecisionAdvicePort,
  DecisionAdviceRequest,
  DecisionAdviceResult,
} from "@hexagen/agentic-interaction";

/**
 * Budgeted decision advice (Jev J5a1): a {@link DecisionAdvicePort} wrapper
 * that refuses a call BEFORE it is made when either invariant-6 cap is
 * exhausted (docs/planning/2026-10-16-jev-decision-advice.md):
 *
 * - the per-generation call count (`JEV_MAX_CALLS_PER_GENERATION`, default 20,
 *   parsed in wire.server);
 * - the daily cost ceiling (`JEV_DAILY_COST_CEILING_USD` in micro-USD), read
 *   from the DURABLE receipts store since midnight UTC, so a redeploy does not
 *   reset it.
 *
 * Concurrency: the web app is a single process (ADR-0064/0065), so one
 * module-level in-process reservation total, serialised by one async mutex (a
 * simple promise chain), covers every in-flight call: the check-and-reserve
 * adds this call's maximum cost before dispatch and settles it after the
 * call. Two concurrent asks therefore cannot both pass the last slot under
 * the ceiling. If a second instance is ever added, the ceiling becomes
 * best-effort, overshooting by at most one call per instance (runbook).
 *
 * Per-generation state: the composition root constructs one wrapper per
 * generation run, so the call count is instance state and resets per
 * generation; the reservation total, the mutex and the unrecorded-cost
 * ledger are module state and survive across generations.
 *
 * Fail closed (invariant 4): a refused check — or ANY error from the spend
 * store, because an unreadable ledger must read as "ceiling unknown" —
 * resolves as `unknown/budget`, never calls the inner port, and today's
 * behaviour stands.
 */

/** The invariant-6 ceiling read; `DecisionReceiptsStore` satisfies this. */
export interface DecisionSpendStore {
  /** Sum of `decision_calls.cost_micro_usd` since midnight UTC of `now`. */
  spentSinceUtcMidnight(now: number): Promise<number>;
}

export interface BudgetedDecisionAdviceOptions {
  /** The wrapped port; called only when the budget check passes. */
  readonly port: DecisionAdvicePort;
  /** Durable spend read for the daily ceiling (the platform receipts store). */
  readonly store: DecisionSpendStore;
  /** `JEV_MAX_CALLS_PER_GENERATION` (default 20, parsed in wire.server). */
  readonly maxCalls: number;
  /** `JEV_DAILY_COST_CEILING_USD` in micro-USD (default 500_000 upstream). */
  readonly ceilingMicroUsd: number;
  /** This call's maximum possible cost in micro-USD; default 1000. */
  readonly callMaxMicroUsd?: number;
}

/** Measured Jev calls cost $0.00002–0.00003; 1000 µUSD is a generous maximum. */
const DEFAULT_CALL_MAX_MICRO_USD = 1000;

// Module-level in-process reservation state (see the header): the web app is
// one process, so these two module bindings are the process-wide ledger.
let reservedTotalMicroUsd = 0;
let mutexTail: Promise<unknown> = Promise.resolve();

/**
 * Costs that have settled but are not yet durable (review note B, lane J5a2).
 * The receipt sink writes each call's row asynchronously, so between the ask
 * settling and that write landing, the store's since-midnight read cannot see
 * the money — the budget check would hand the same ceiling room to a later
 * call. Entries are parked here (keyed by requestId) before the reservation
 * releases and removed by {@link markDecisionCallRecorded} once the row
 * exists. A write that never lands leaves its entry in place for the
 * process's lifetime: the conservative direction for a ceiling.
 */
const unrecordedCostMicroUsd = new Map<string, number>();

/** The ledger's total, folded into the daily-ceiling check. */
function unrecordedTotalMicroUsd(): number {
  let total = 0;
  for (const cost of unrecordedCostMicroUsd.values()) total += cost;
  return total;
}

/**
 * Remove one settled call's cost from the unrecorded ledger. The receipt
 * sink calls this AFTER the durable write resolves, so the cost is counted
 * through the store read alone — never twice. A no-op for an id that was
 * never parked (e.g. `""`, when no provider call was made).
 */
export function markDecisionCallRecorded(requestId: string): void {
  unrecordedCostMicroUsd.delete(requestId);
}

/**
 * Run `critical` after every previously queued one — a simple promise-chain
 * mutex. The tail swallows rejections so a failed section cannot wedge the
 * chain; `critical` itself never rejects (every failure path returns).
 */
function runSerialized<T>(critical: () => Promise<T>): Promise<T> {
  const result = mutexTail.then(critical);
  mutexTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function createBudgetedDecisionAdvice(
  options: BudgetedDecisionAdviceOptions,
): DecisionAdvicePort {
  const callMaxMicroUsd = options.callMaxMicroUsd ?? DEFAULT_CALL_MAX_MICRO_USD;
  // Per-generation (per-instance): one wrapper is built per generation run.
  let callsThisGeneration = 0;

  return {
    async ask(request: DecisionAdviceRequest): Promise<DecisionAdviceResult> {
      const now = Date.now();
      // Check-and-reserve under the one mutex: the durable read, the pure
      // checkBudget rule and the reservation update are one atomic section.
      const reserved = await runSerialized(async (): Promise<boolean> => {
        let spentTodayMicroUsd: number;
        try {
          spentTodayMicroUsd = await options.store.spentSinceUtcMidnight(now);
        } catch {
          return false;
        }
        const check = checkBudget({
          callsThisGeneration,
          maxCalls: options.maxCalls,
          // Invariant 6's total: durable spend, plus the unrecorded ledger
          // (settled calls whose receipt row has not landed yet), plus the
          // in-flight reservations — checked as one sum.
          spentTodayMicroUsd: spentTodayMicroUsd + unrecordedTotalMicroUsd(),
          reservedMicroUsd: reservedTotalMicroUsd,
          ceilingMicroUsd: options.ceilingMicroUsd,
          callMaxMicroUsd,
        });
        if (!check.allowed) return false;
        callsThisGeneration += 1;
        reservedTotalMicroUsd += callMaxMicroUsd;
        return true;
      });

      if (!reserved) {
        // Invariant 4: a refused budget is "no advice"; the inner port is
        // never called and today's behaviour stands.
        return { status: "unknown", reason: "budget" };
      }

      try {
        const result = await options.port.ask(request);
        // Park the settled cost BEFORE the reservation releases (the finally
        // below): the caller's receipt sink writes the durable row
        // asynchronously, so until that write lands the store read alone
        // undercounts the day. `receipt` is optional only on the unknown
        // variant; a result with no requestId made no provider call, so there
        // is nothing to park and nothing to later mark recorded.
        const receipt = result.receipt;
        if (receipt && receipt.requestId !== "") {
          unrecordedCostMicroUsd.set(
            receipt.requestId,
            receipt.costMicroUsd ?? callMaxMicroUsd,
          );
        }
        return result;
      } catch {
        // The port's own contract: never throw for an expected failure. The
        // wrapper keeps that promise even for a misbehaving inner port.
        return { status: "unknown", reason: "error" };
      } finally {
        // Settle the reservation: the call is no longer in flight, and its
        // actual cost is now either durable (the receipt sink wrote it) or
        // parked in the unrecorded ledger — either way the next ask counts
        // it. Synchronous, so it cannot interleave with another section's
        // await points.
        reservedTotalMicroUsd -= callMaxMicroUsd;
      }
    },
  };
}
