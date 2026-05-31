// @hexagen-server-only
import type {
  FireflyJobPort,
  JobHandle,
  JobResult,
} from "../../../domain/ports/out/firefly-job.port";
import { fetchStatus, pollJobStatus } from "./job-poller";
import { FireflyError } from "../errors/firefly-errors";

/**
 * Concrete `FireflyJobPort` wired to the configured completion transport.
 *
 * - `polling` ({job_mode} default): `await()` drives the poller against the
 *   job's status URL.
 * - `webhook`: `await()` parks a promise keyed by jobId; the webhook receiver
 *   (see `webhook-verifier.ts`, emitted only in webhook mode) calls `resolveJob`
 *   to settle BOTH terminal states (a `failed` job resolves with its JobResult,
 *   matching polling — it does not reject). `rejectJob` exists for transport-level
 *   failures only. Both live on the concrete class — not the port — so the gated
 *   webhook file imports this always-emitted module, never the reverse (no static
 *   import of a gated file).
 *
 * SCALING LIMIT (webhook mode): the pending registry is in-memory, so it is
 * correct only for a SINGLE long-lived instance. In serverless / horizontally
 * scaled deployments the instance that called `await()` may not be the one that
 * receives Adobe's callback, and the promise will never settle. For those
 * topologies use `polling`, or back this registry with a shared store
 * (Redis/BullMQ, Postgres). A fast-job race (webhook arriving before `await()`
 * parks the promise) is handled in-process via the `settled` buffer below.
 */
const JOB_MODE = "{job_mode}";
// How long a webhook `await()` waits before giving up (so a callback that never
// arrives rejects instead of hanging/leaking). Overridable per deployment.
const WEBHOOK_TIMEOUT_MS = Number(process.env.ADOBE_WEBHOOK_TIMEOUT_MS ?? 600_000);
// How long an early-arriving result is buffered for an imminent `await()`.
const SETTLED_TTL_MS = 60_000;

interface Outcome {
  result?: JobResult;
  error?: Error;
}

interface Waiter {
  settle: (outcome: Outcome) => void;
  timer: ReturnType<typeof setTimeout>;
}

class FireflyJobAdapter implements FireflyJobPort {
  // Multiple callers may await the same jobId — keep a set of waiters, not one.
  private readonly pending = new Map<string, Set<Waiter>>();
  // Results that arrived (via webhook) before `await()` parked, with a TTL.
  private readonly settled = new Map<string, Outcome>();

  async await(handle: JobHandle): Promise<JobResult> {
    if (JOB_MODE !== "webhook") return pollJobStatus(handle);

    const { jobId } = handle;
    // Webhook mode keys the pending registry by jobId — an empty id (a submit
    // response that carried no job id) would collide unrelated jobs and settle the
    // wrong waiter. Fail fast so the service adapter surfaces a clear error.
    // (Polling mode is already guarded by the poller's status-URL check.)
    if (!jobId) {
      throw new FireflyError("Cannot await a webhook job: the submit response carried no job id to correlate.");
    }
    // Fast-job race: the webhook may have landed before we got here.
    const early = this.settled.get(jobId);
    if (early) {
      this.settled.delete(jobId);
      return unwrap(early);
    }

    return new Promise<JobResult>((resolve, reject) => {
      const waiters = this.pending.get(jobId) ?? new Set<Waiter>();
      const waiter: Waiter = {
        settle: (outcome) => {
          clearTimeout(waiter.timer);
          waiters.delete(waiter);
          if (waiters.size === 0) this.pending.delete(jobId);
          try {
            resolve(unwrap(outcome));
          } catch (e) {
            reject(e as Error);
          }
        },
        timer: setTimeout(() => {
          waiter.settle({
            error: new FireflyError(
              `Webhook for job ${jobId} did not arrive within ${WEBHOOK_TIMEOUT_MS}ms`,
              408,
              true,
            ),
          });
        }, WEBHOOK_TIMEOUT_MS),
      };
      // Don't keep the process alive solely for a pending webhook.
      waiter.timer.unref?.();
      waiters.add(waiter);
      this.pending.set(jobId, waiters);
    });
  }

  async status(handle: JobHandle): Promise<JobResult> {
    return fetchStatus(handle);
  }

  /** Webhook seam: settle a job as completed (all waiters), or buffer if none yet. */
  resolveJob(jobId: string, result: JobResult): void {
    this.settle(jobId, { result });
  }

  /** Webhook seam: settle a job as failed (all waiters), or buffer if none yet. */
  rejectJob(jobId: string, error: Error): void {
    this.settle(jobId, { error });
  }

  private settle(jobId: string, outcome: Outcome): void {
    const waiters = this.pending.get(jobId);
    if (waiters && waiters.size > 0) {
      // Copy then settle — `settle()` mutates the set as it drains.
      for (const waiter of [...waiters]) waiter.settle(outcome);
      return;
    }
    // Webhook beat await(): buffer with a TTL so an unawaited result can't leak.
    this.settled.set(jobId, outcome);
    const evict = setTimeout(() => this.settled.delete(jobId), SETTLED_TTL_MS);
    evict.unref?.();
  }
}

function unwrap(outcome: Outcome): JobResult {
  if (outcome.error) throw outcome.error;
  return outcome.result!;
}

/** Shared singleton used by all service adapters (and the webhook receiver). */
export const jobPort = new FireflyJobAdapter();
export { FireflyJobAdapter };
