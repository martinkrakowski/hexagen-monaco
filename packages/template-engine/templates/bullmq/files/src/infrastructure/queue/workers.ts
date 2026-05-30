import { Worker, type Job, type Processor } from "bullmq";
import { getRedisConnection, isFallbackActive } from "./connection";
import { QUEUE_NAMES, type QueueName } from "./queues";

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? "{concurrency}");

const workers: Worker[] = [];

/**
 * Map of (queueName, jobName) → handler. Each job file's bootstrap should
 * register its handler here at import time so the dispatcher in this file
 * can route to it without an explicit `if (job.name === ...)` chain.
 */
type JobHandler = (job: Job) => Promise<unknown>;

const handlers = new Map<string, JobHandler>();

function handlerKey(queue: QueueName, jobName: string): string {
  return `${queue}:${jobName}`;
}

/**
 * Wire a job handler. Call this once per (queue, jobName) at module load —
 * server/startup/start-workers.ts imports each enabled job file to trigger
 * its registration before {@link startWorkers} is invoked.
 */
export function registerJobHandler(
  queue: QueueName,
  jobName: string,
  handler: JobHandler,
): void {
  handlers.set(handlerKey(queue, jobName), handler);
}

const dispatcher =
  (queue: QueueName): Processor =>
  async (job) => {
    const handler = handlers.get(handlerKey(queue, job.name));
    if (!handler) {
      throw new Error(
        `worker(${queue}): no handler registered for job '${job.name}'. Did the job file import its registration block?`,
      );
    }
    return handler(job);
  };

export function startWorkers(): Worker[] {
  if (isFallbackActive()) {
    // In fallback mode there's no Redis to subscribe to; jobs are executed
    // synchronously by addJob() via the in-process executor. Workers stay
    // unstarted, but the function is still callable so server bootstrap code
    // doesn't need to branch.
    // eslint-disable-next-line no-console
    console.warn(
      "[bullmq] startWorkers(): fallback mode active — no Workers started; jobs run inline via addJob().",
    );
    return [];
  }

  const connection = getRedisConnection();
  if (!connection) {
    throw new Error(
      "startWorkers(): Redis connection is null but fallback is not active. Check BULLMQ_FALLBACK_MODE.",
    );
  }

  for (const queue of QUEUE_NAMES) {
    const worker = new Worker(queue, dispatcher(queue), {
      connection,
      concurrency: CONCURRENCY,
    });
    worker.on("failed", (job, err) => {
      // eslint-disable-next-line no-console
      console.error(
        `[bullmq:${queue}] job failed`,
        { jobId: job?.id, jobName: job?.name, err: err.message },
      );
    });
    worker.on("error", (err) => {
      // eslint-disable-next-line no-console
      console.error(`[bullmq:${queue}] worker error`, { err: err.message });
    });
    workers.push(worker);
  }
  return workers;
}

export async function stopWorkers(): Promise<void> {
  await Promise.all(workers.map((w) => w.close().catch(() => undefined)));
  workers.length = 0;
}
