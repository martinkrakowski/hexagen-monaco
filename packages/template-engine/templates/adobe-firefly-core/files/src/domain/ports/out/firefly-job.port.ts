/**
 * Outbound port for Firefly async jobs.
 *
 * Most Firefly operations are asynchronous: a `POST` returns a job, whose result
 * arrives later by polling a status URL or by an inbound webhook. This port hides
 * that transport — service adapters depend only on `await(handle)` and never know
 * which mode is configured, so switching polling↔webhook touches no adapter.
 *
 * Terminal failures (job `failed`, transport errors) are surfaced as thrown
 * `FireflyError`s; service adapters catch and convert them to `Result`.
 */
export type JobStatus = "running" | "succeeded" | "failed";

export interface JobOutput {
  /** Presigned href of an asset output (most services). */
  readonly href?: string;
  /** Inline JSON output (e.g. Content Tagging — the non-asset path). */
  readonly data?: unknown;
}

export interface JobResult {
  readonly jobId: string;
  readonly status: JobStatus;
  readonly outputs: JobOutput[];
  /** Failure detail when `status === "failed"`. */
  readonly error?: string;
}

export interface JobHandle {
  readonly jobId: string;
  /** Absolute status URL returned by the submit call (used in polling mode). */
  readonly statusUrl?: string;
}

export interface FireflyJobPort {
  /** Await terminal completion (polling or webhook, transparently). */
  await(handle: JobHandle): Promise<JobResult>;
  /** One-shot status check without waiting. */
  status(handle: JobHandle): Promise<JobResult>;
}
