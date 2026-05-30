import {
  closeAllQueues,
  disconnectRedis,
  QUEUE_NAMES,
  type QueueName,
  registerFallbackHandler,
  registerJobHandler,
  scheduleRecurringJobs,
  startWorkers,
  stopWorkers,
} from "../../src/infrastructure/queue";

// Same-process worker bootstrap. Wire `bootstrapWorkers()` into your
// Next.js custom server, `instrumentation.ts`, or wherever your app
// performs one-time startup. The companion `shutdownWorkers()` is exposed
// for the host application to invoke during ITS shutdown lifecycle —
// this file intentionally does NOT install process-level SIGINT/SIGTERM
// handlers in same-process mode, because doing so hijacks Next.js's
// graceful HTTP shutdown and drops in-flight requests. The separate-
// service entrypoint (scripts/start-worker.ts) installs its own signal
// handlers because it owns the process.

interface JobModule {
  jobName: string;
  defaultQueue: string;
  handler: (job: never) => Promise<unknown>;
}

/**
 * Distinguish "this exact job file isn't installed" from a real init failure
 * (syntax error, missing transitive dep, throwing top-level code) — only the
 * former should be silently skipped. Node's ESM loader reports a missing
 * module as `ERR_MODULE_NOT_FOUND` with the failing specifier in the
 * message, so we accept the error only if BOTH conditions match the
 * job file we tried to import. Any other shape is rethrown so the operator
 * sees the real problem instead of a worker that mysteriously does nothing.
 */
function isMissingJobModule(err: unknown, specifier: string): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code;
  if (code !== "ERR_MODULE_NOT_FOUND") return false;
  return err.message.includes(specifier);
}

async function loadOptionalJob(
  specifier: string,
  pick: (m: Record<string, unknown>) => JobModule,
): Promise<JobModule | null> {
  try {
    const m = (await import(specifier)) as Record<string, unknown>;
    return pick(m);
  } catch (err) {
    if (isMissingJobModule(err, specifier)) return null;
    throw err;
  }
}

async function loadEnabledJobs(): Promise<JobModule[]> {
  // Each block dynamic-imports a job file and is tolerated as missing only
  // when the file genuinely isn't installed. Anything else (syntax error,
  // throwing init code, missing transitive dep) propagates so it surfaces
  // at startup rather than as a silently-disabled handler at runtime.
  const candidates = await Promise.all([
    loadOptionalJob(
      "../../src/infrastructure/queue/jobs/image-processing.job",
      (m) => ({
        jobName: m.IMAGE_PROCESSING_JOB_NAME as string,
        defaultQueue: m.IMAGE_PROCESSING_DEFAULT_QUEUE as string,
        handler: m.processImageProcessingJob as JobModule["handler"],
      }),
    ),
    loadOptionalJob(
      "../../src/infrastructure/queue/jobs/email.job",
      (m) => ({
        jobName: m.EMAIL_JOB_NAME as string,
        defaultQueue: m.EMAIL_DEFAULT_QUEUE as string,
        handler: m.processEmailJob as JobModule["handler"],
      }),
    ),
    loadOptionalJob(
      "../../src/infrastructure/queue/jobs/webhook.job",
      (m) => ({
        jobName: m.WEBHOOK_JOB_NAME as string,
        defaultQueue: m.WEBHOOK_DEFAULT_QUEUE as string,
        handler: m.processWebhookJob as JobModule["handler"],
      }),
    ),
    loadOptionalJob(
      "../../src/infrastructure/queue/jobs/export.job",
      (m) => ({
        jobName: m.EXPORT_JOB_NAME as string,
        defaultQueue: m.EXPORT_DEFAULT_QUEUE as string,
        handler: m.processExportJob as JobModule["handler"],
      }),
    ),
    loadOptionalJob(
      "../../src/infrastructure/queue/jobs/ai-generation.job",
      (m) => ({
        jobName: m.AI_GENERATION_JOB_NAME as string,
        defaultQueue: m.AI_GENERATION_DEFAULT_QUEUE as string,
        handler: m.processAIGenerationJob as JobModule["handler"],
      }),
    ),
  ]);
  return candidates.filter((c): c is JobModule => c !== null);
}

function pickQueueForJob(job: JobModule): QueueName | null {
  // Prefer the job's declared default queue when it's enabled at runtime;
  // otherwise fall through to the first enabled queue. With QueueName as a
  // literal union we cast the runtime list to string[] for the membership
  // check, then re-narrow on a hit. If there is no enabled queue at all the
  // job is silently skipped — registerHandlers logs that case.
  const names = QUEUE_NAMES as ReadonlyArray<string>;
  if (names.includes(job.defaultQueue)) return job.defaultQueue as QueueName;
  return (QUEUE_NAMES[0] as QueueName | undefined) ?? null;
}

async function registerHandlers(): Promise<void> {
  const jobs = await loadEnabledJobs();
  for (const job of jobs) {
    const queue = pickQueueForJob(job);
    if (queue === null) {
      // eslint-disable-next-line no-console
      console.warn(
        `[bullmq] no enabled queues — skipping handler registration for job '${job.jobName}'.`,
      );
      continue;
    }
    registerJobHandler(queue, job.jobName, job.handler);
    registerFallbackHandler(queue, job.jobName, job.handler);
  }
}

let started = false;

export async function bootstrapWorkers(): Promise<void> {
  if (started) return;
  // The flag only flips after the full sequence succeeds. If we set it up
  // front and registerHandlers/startWorkers/scheduleRecurringJobs throws,
  // every retry would short-circuit on `if (started) return` while the
  // process sits in a half-started state — workers spawned but no scheduler,
  // or handlers registered against a queue that never opened a Worker.
  try {
    await registerHandlers();
    startWorkers();
    await scheduleRecurringJobs();
    started = true;
  } catch (error) {
    // Roll back partial state so the next bootstrapWorkers() call can retry
    // from a clean slate. All three rollback steps are swallowed because the
    // original error is what the caller needs to see.
    await stopWorkers().catch(() => undefined);
    await closeAllQueues().catch(() => undefined);
    await disconnectRedis().catch(() => undefined);
    throw error;
  }
}

/**
 * Stop workers + close queues + disconnect Redis. Idempotent. The host
 * application should call this during its own graceful shutdown — see the
 * `instrumentation.ts` pattern in Next.js, or your custom server's exit
 * hook. The separate-service entrypoint installs SIGINT/SIGTERM handlers
 * around this function because it owns the process.
 */
export async function shutdownWorkers(): Promise<void> {
  await stopWorkers();
  await closeAllQueues();
  await disconnectRedis();
}
