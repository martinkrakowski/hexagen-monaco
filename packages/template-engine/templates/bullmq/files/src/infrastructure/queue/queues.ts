import { Queue, type Job, type JobsOptions } from "bullmq";
import { getRedisConnection, isFallbackActive } from "./connection";
import { executeSync, type SyncJob } from "./fallback/sync-executor";

// Queue names configured at install time; comma-separated env var overrides
// the static default so a deployment can adjust without re-running the
// template generator.
const QUEUE_NAMES_RAW =
  process.env.BULLMQ_QUEUE_NAMES ?? "{queue_names}";

export const QUEUE_NAMES = QUEUE_NAMES_RAW.split(",")
  .map((n) => n.trim())
  .filter(Boolean);

/**
 * Compile-time-narrow type for the configured queue names. Built from a
 * runtime list because the install-time answer is a free-text comma list,
 * but a callsite that imports `QueueName` from this module gets the same
 * IntelliSense as a literal union.
 */
export type QueueName = (typeof QUEUE_NAMES)[number];

const queues = new Map<QueueName, Queue>();

function getQueueInternal(name: QueueName): Queue {
  let queue = queues.get(name);
  if (!queue) {
    const connection = getRedisConnection();
    if (!connection) {
      throw new Error(
        `getQueue('${name}'): Redis connection is unavailable. In fallback mode the queue object is not created; use addJob() which routes to the in-process executor automatically.`,
      );
    }
    queue = new Queue(name, { connection });
    queues.set(name, queue);
  }
  return queue;
}

export function getQueue(name: QueueName): Queue {
  return getQueueInternal(name);
}

/**
 * Schedule a job for processing. In normal mode the data is pushed to
 * Redis-backed BullMQ; in fallback mode the registered handler is invoked
 * inline and the returned shape mimics a BullMQ Job so callers don't need
 * branchy code at the call site.
 *
 * Handlers for fallback mode live alongside the queue at registration time
 * via {@link registerFallbackHandler}. If a job is added to a queue with no
 * registered handler while Redis is down, the call rejects so the
 * misconfiguration surfaces immediately.
 */
// Fallback handlers take a Job-shaped argument (built by executeSync), so
// the signature matches the BullMQ Worker callback exactly — the same
// handler can be passed unmodified to both the worker dispatcher and the
// fallback registry, without `as never` casts at the call site.
type FallbackHandler<TData, TResult> = (job: Job<TData>) => Promise<TResult>;

const fallbackHandlers = new Map<string, FallbackHandler<unknown, unknown>>();

function fallbackKey(queue: QueueName, jobName: string): string {
  return `${queue}:${jobName}`;
}

export function registerFallbackHandler<TData, TResult>(
  queue: QueueName,
  jobName: string,
  handler: FallbackHandler<TData, TResult>,
): void {
  fallbackHandlers.set(
    fallbackKey(queue, jobName),
    handler as FallbackHandler<unknown, unknown>,
  );
}

export async function addJob<TData = unknown, TResult = unknown>(
  queue: QueueName,
  jobName: string,
  data: TData,
  opts?: JobsOptions,
): Promise<Job<TData, TResult> | SyncJob<TData, TResult>> {
  if (isFallbackActive()) {
    const handler = fallbackHandlers.get(fallbackKey(queue, jobName)) as
      | FallbackHandler<TData, TResult>
      | undefined;
    if (!handler) {
      throw new Error(
        `addJob('${queue}', '${jobName}'): no fallback handler registered and Redis is unavailable. Register via registerFallbackHandler() at module load.`,
      );
    }
    return executeSync(jobName, data, handler);
  }
  const q = getQueueInternal(queue);
  return (await q.add(jobName, data, opts)) as Job<TData, TResult>;
}

export async function closeAllQueues(): Promise<void> {
  for (const [, queue] of queues) {
    await queue.close().catch(() => undefined);
  }
  queues.clear();
}
