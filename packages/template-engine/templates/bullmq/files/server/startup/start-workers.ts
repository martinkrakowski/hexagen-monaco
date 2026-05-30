import {
  registerFallbackHandler,
  registerJobHandler,
  scheduleRecurringJobs,
  startWorkers,
  stopWorkers,
  disconnectRedis,
  closeAllQueues,
} from "../../src/infrastructure/queue";

// Same-process worker bootstrap. Wire this into your Next.js custom server,
// `instrumentation.ts`, or whichever entrypoint runs once at server start.
//
// Separate-service deployments should NOT import this file — they run
// scripts/start-worker.ts (gated on worker_mode=separate-service) in a
// dedicated worker process. Keeping both surfaces makes switching modes a
// one-line change in deployment config rather than a code refactor.

const ENABLED_QUEUES = "{queue_names}"
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

async function registerHandlers(): Promise<void> {
  // Each example job file (emitted when `job_examples` includes the matching
  // entry) exposes a typed handler plus a constant for the job name. Wire
  // the handler into BOTH the worker dispatcher and the in-process fallback
  // executor so addJob() works the same regardless of Redis availability.
  //
  // The dynamic imports below are guarded by try/catch: if a particular
  // example wasn't selected at install time the file won't exist, the import
  // fails, and we silently skip — no consumer code change required when a
  // single example is later removed.
  for (const queue of ENABLED_QUEUES) {
    try {
      const mod = await import(
        "../../src/infrastructure/queue/jobs/image-processing.job"
      );
      registerJobHandler(queue, mod.IMAGE_PROCESSING_JOB_NAME, mod.processImageProcessingJob);
      registerFallbackHandler(
        queue,
        mod.IMAGE_PROCESSING_JOB_NAME,
        (data) =>
          mod.processImageProcessingJob({ data, log: async () => {}, updateProgress: async () => {}, id: "" } as never),
      );
    } catch {
      // job example not installed
    }
    try {
      const mod = await import("../../src/infrastructure/queue/jobs/email.job");
      registerJobHandler(queue, mod.EMAIL_JOB_NAME, mod.processEmailJob);
      registerFallbackHandler(queue, mod.EMAIL_JOB_NAME, (data) =>
        mod.processEmailJob({ data, log: async () => {}, id: "" } as never),
      );
    } catch {
      // not installed
    }
    try {
      const mod = await import("../../src/infrastructure/queue/jobs/webhook.job");
      registerJobHandler(queue, mod.WEBHOOK_JOB_NAME, mod.processWebhookJob);
      registerFallbackHandler(queue, mod.WEBHOOK_JOB_NAME, (data) =>
        mod.processWebhookJob({ data, log: async () => {}, id: "" } as never),
      );
    } catch {
      // not installed
    }
    try {
      const mod = await import("../../src/infrastructure/queue/jobs/export.job");
      registerJobHandler(queue, mod.EXPORT_JOB_NAME, mod.processExportJob);
      registerFallbackHandler(queue, mod.EXPORT_JOB_NAME, (data) =>
        mod.processExportJob({ data, log: async () => {}, updateProgress: async () => {}, id: "" } as never),
      );
    } catch {
      // not installed
    }
    try {
      const mod = await import("../../src/infrastructure/queue/jobs/ai-generation.job");
      registerJobHandler(queue, mod.AI_GENERATION_JOB_NAME, mod.processAIGenerationJob);
      registerFallbackHandler(queue, mod.AI_GENERATION_JOB_NAME, (data) =>
        mod.processAIGenerationJob({ data, log: async () => {}, updateProgress: async () => {}, id: "" } as never),
      );
    } catch {
      // not installed
    }
  }
}

let started = false;

export async function bootstrapWorkers(): Promise<void> {
  if (started) return;
  started = true;
  await registerHandlers();
  startWorkers();
  await scheduleRecurringJobs();

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, async () => {
      // eslint-disable-next-line no-console
      console.log(`[bullmq] ${signal} received, shutting down workers…`);
      await stopWorkers();
      await closeAllQueues();
      await disconnectRedis();
      process.exit(0);
    });
  }
}
