import {
  closeAllQueues,
  disconnectRedis,
  QUEUE_NAMES,
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

async function loadEnabledJobs(): Promise<JobModule[]> {
  const out: JobModule[] = [];
  // Each block try/catch'es a dynamic import so a job example not selected
  // at install time silently no-ops. The list is centralised here so adding
  // a new example is a one-block edit, not a recompile of the consumer app.
  try {
    const m = await import(
      "../../src/infrastructure/queue/jobs/image-processing.job"
    );
    out.push({
      jobName: m.IMAGE_PROCESSING_JOB_NAME,
      defaultQueue: m.IMAGE_PROCESSING_DEFAULT_QUEUE,
      handler: m.processImageProcessingJob as JobModule["handler"],
    });
  } catch {
    /* not installed */
  }
  try {
    const m = await import("../../src/infrastructure/queue/jobs/email.job");
    out.push({
      jobName: m.EMAIL_JOB_NAME,
      defaultQueue: m.EMAIL_DEFAULT_QUEUE,
      handler: m.processEmailJob as JobModule["handler"],
    });
  } catch {
    /* not installed */
  }
  try {
    const m = await import("../../src/infrastructure/queue/jobs/webhook.job");
    out.push({
      jobName: m.WEBHOOK_JOB_NAME,
      defaultQueue: m.WEBHOOK_DEFAULT_QUEUE,
      handler: m.processWebhookJob as JobModule["handler"],
    });
  } catch {
    /* not installed */
  }
  try {
    const m = await import("../../src/infrastructure/queue/jobs/export.job");
    out.push({
      jobName: m.EXPORT_JOB_NAME,
      defaultQueue: m.EXPORT_DEFAULT_QUEUE,
      handler: m.processExportJob as JobModule["handler"],
    });
  } catch {
    /* not installed */
  }
  try {
    const m = await import(
      "../../src/infrastructure/queue/jobs/ai-generation.job"
    );
    out.push({
      jobName: m.AI_GENERATION_JOB_NAME,
      defaultQueue: m.AI_GENERATION_DEFAULT_QUEUE,
      handler: m.processAIGenerationJob as JobModule["handler"],
    });
  } catch {
    /* not installed */
  }
  return out;
}

function pickQueueForJob(job: JobModule): string {
  // Prefer the job's declared default queue when it's configured at install
  // time; otherwise fall through to the first enabled queue. This keeps
  // the smallest install (single "default" queue) working while honouring
  // the per-job affinity declared in each jobs/<name>.job.ts file.
  if (QUEUE_NAMES.includes(job.defaultQueue)) return job.defaultQueue;
  return QUEUE_NAMES[0] ?? job.defaultQueue;
}

async function registerHandlers(): Promise<void> {
  const jobs = await loadEnabledJobs();
  for (const job of jobs) {
    const queue = pickQueueForJob(job);
    registerJobHandler(queue, job.jobName, job.handler);
    registerFallbackHandler(queue, job.jobName, job.handler);
  }
}

let started = false;

export async function bootstrapWorkers(): Promise<void> {
  if (started) return;
  started = true;
  await registerHandlers();
  startWorkers();
  await scheduleRecurringJobs();
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
