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
 */
const JOB_MODE = "{job_mode}";

interface PendingJob {
  resolve: (result: JobResult) => void;
  reject: (error: Error) => void;
}

class FireflyJobAdapter implements FireflyJobPort {
  private readonly pending = new Map<string, PendingJob>();

  async await(handle: JobHandle): Promise<JobResult> {
    if (JOB_MODE === "webhook") {
      return new Promise<JobResult>((resolve, reject) => {
        this.pending.set(handle.jobId, { resolve, reject });
      });
    }
    return pollJobStatus(handle);
  }

  async status(handle: JobHandle): Promise<JobResult> {
    return fetchStatus(handle);
  }

  /** Webhook seam: settle a parked job as completed. No-op if not awaited. */
  resolveJob(jobId: string, result: JobResult): void {
    const job = this.pending.get(jobId);
    if (!job) return;
    this.pending.delete(jobId);
    job.resolve(result);
  }

  /** Webhook seam: settle a parked job as failed. */
  rejectJob(jobId: string, error: Error): void {
    const job = this.pending.get(jobId);
    if (!job) return;
    this.pending.delete(jobId);
    job.reject(error);
  }
}

/** Shared singleton used by all service adapters (and the webhook receiver). */
export const jobPort = new FireflyJobAdapter();
export { FireflyJobAdapter };
