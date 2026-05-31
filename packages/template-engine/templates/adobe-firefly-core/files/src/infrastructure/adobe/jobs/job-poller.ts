// @hexagen-server-only
import type { JobHandle, JobResult } from "../../../domain/ports/out/firefly-job.port";
import { fireflyClient } from "../http/firefly-client";
import { FireflyError } from "../errors/firefly-errors";
import { parseJobResult } from "./job-result";

/**
 * Polls a job's status URL until it reaches a terminal state. Used in `polling`
 * mode by the job port. Interval comes from ADOBE_JOB_POLL_INTERVAL_MS with a
 * gentle backoff and a hard cap so very long jobs (media/substance) don't hammer
 * the API. A handle without a `statusUrl` cannot be polled — that's a programmer
 * error (the submit call should have captured it).
 */
const MAX_BACKOFF_MS = 30_000;

export interface PollOptions {
  /** Stop after this long and throw; default unbounded (caller owns the deadline). */
  maxWaitMs?: number;
}

export async function pollJobStatus(handle: JobHandle, opts: PollOptions = {}): Promise<JobResult> {
  if (!handle.statusUrl) {
    throw new FireflyError(`Cannot poll job ${handle.jobId}: no status URL was captured at submit.`);
  }
  const baseInterval = Number(process.env.ADOBE_JOB_POLL_INTERVAL_MS ?? 2000);
  const startedAt = Date.now();

  for (let attempt = 0; ; attempt++) {
    const result = await fetchStatus(handle);
    if (result.status !== "running") return result;

    if (opts.maxWaitMs !== undefined && Date.now() - startedAt >= opts.maxWaitMs) {
      throw new FireflyError(`Job ${handle.jobId} did not complete within ${opts.maxWaitMs}ms`, 408, true);
    }
    await delay(Math.min(baseInterval * 2 ** Math.min(attempt, 4), MAX_BACKOFF_MS));
  }
}

/** Single status read, shared by the poller and the port's `status()`. */
export async function fetchStatus(handle: JobHandle): Promise<JobResult> {
  if (!handle.statusUrl) {
    // Without a status URL we'd otherwise GET the base endpoint — fail fast
    // instead, consistent with `pollJobStatus`.
    throw new FireflyError(`Cannot check job ${handle.jobId}: no status URL was captured at submit.`);
  }
  const raw = await fireflyClient.get<unknown>(handle.statusUrl);
  return parseJobResult(raw, handle.jobId);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
