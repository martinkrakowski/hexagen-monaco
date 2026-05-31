// @hexagen-server-only
import type {
  FireflyJobPort,
  JobHandle,
  JobResult,
} from "../../../domain/ports/out/firefly-job.port";
import { fetchStatus, pollJobStatus } from "./job-poller";

/**
 * Concrete `FireflyJobPort` wired to the configured completion transport.
 *
 * - `polling` ({job_mode} default): `await()` drives the poller against the
 *   job's status URL.
 * - `webhook`: `await()` parks a promise keyed by jobId; the webhook receiver
 *   (see `webhook-verifier.ts`, emitted only in webhook mode) calls
 *   `resolveJob`/`rejectJob` to settle it. `resolveJob`/`rejectJob` live on the
 *   concrete class — not the port — so the gated webhook file imports this
 *   always-emitted module, never the reverse (no static import of a gated file).
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

interface PendingJob {
  resolve: (result: JobResult) => void;
  reject: (error: Error) => void;
}

class FireflyJobAdapter implements FireflyJobPort {
  private readonly pending = new Map<string, PendingJob>();
  // Results that arrived (via webhook) before `await()` parked their promise.
  private readonly settled = new Map<string, { result?: JobResult; error?: Error }>();

  async await(handle: JobHandle): Promise<JobResult> {
    if (JOB_MODE === "webhook") {
      // Fast-job race: the webhook may have landed before we got here.
      const early = this.settled.get(handle.jobId);
      if (early) {
        this.settled.delete(handle.jobId);
        if (early.error) throw early.error;
        return early.result!;
      }
      return new Promise<JobResult>((resolve, reject) => {
        this.pending.set(handle.jobId, { resolve, reject });
      });
    }
    return pollJobStatus(handle);
  }

  async status(handle: JobHandle): Promise<JobResult> {
    return fetchStatus(handle);
  }

  /** Webhook seam: settle a parked job as completed, or buffer if `await()` hasn't run yet. */
  resolveJob(jobId: string, result: JobResult): void {
    const job = this.pending.get(jobId);
    if (job) {
      this.pending.delete(jobId);
      job.resolve(result);
      return;
    }
    this.settled.set(jobId, { result });
  }

  /** Webhook seam: settle a parked job as failed, or buffer if `await()` hasn't run yet. */
  rejectJob(jobId: string, error: Error): void {
    const job = this.pending.get(jobId);
    if (job) {
      this.pending.delete(jobId);
      job.reject(error);
      return;
    }
    this.settled.set(jobId, { error });
  }
}

/** Shared singleton used by all service adapters (and the webhook receiver). */
export const jobPort = new FireflyJobAdapter();
export { FireflyJobAdapter };
