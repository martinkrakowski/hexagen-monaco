import { Queue, type Job, type JobsOptions } from "bullmq";
import { getRedisConnection, isFallbackActive } from "./connection";
import { executeSync, type SyncJob } from "./fallback/sync-executor";

// The install-time comma-list is captured as a string literal *type* so
// the typed surface (QueueName) is a literal union of the configured names,
// not the broad `string`. The runtime list is derived from the same answer
// (or a BULLMQ_QUEUE_NAMES override, validated against the install set
// further down) so the two stay in lock-step.
type InstallQueueNamesLiteral = "{queue_names}";

type _TrimWs<S extends string> = S extends ` ${infer R}`
  ? _TrimWs<R>
  : S extends `${infer R} `
    ? _TrimWs<R>
    : S;

type _SplitCsv<S extends string> = S extends `${infer Head},${infer Tail}`
  ? _TrimWs<Head> | _SplitCsv<Tail>
  : _TrimWs<S>;

/**
 * Literal union of every queue name configured at install time. addJob(),
 * getQueue(), and registerJobHandler() all narrow their `queue` arg to this
 * union, so typos surface at compile time rather than as a runtime
 * "no handler registered" error after the job has already been enqueued.
 */
export type QueueName = _SplitCsv<InstallQueueNamesLiteral>;

const INSTALL_QUEUE_NAMES = "{queue_names}"
  .split(",")
  .map((n) => n.trim())
  .filter(Boolean) as QueueName[];

// BULLMQ_QUEUE_NAMES can override the install-time list at deploy time, but
// only with a *subset* of the names declared at install — anything else
// would mean workers start for a queue without a registered handler, or
// handlers register for a queue that no Worker ever opens. We validate up
// front and throw with the offending names so the misconfiguration surfaces
// at boot rather than as a per-job dispatcher error later.
function resolveRuntimeQueueNames(): QueueName[] {
  const override = process.env.BULLMQ_QUEUE_NAMES;
  if (!override) return INSTALL_QUEUE_NAMES;
  const parsed = override
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  const unknown = parsed.filter(
    (n) => !(INSTALL_QUEUE_NAMES as string[]).includes(n),
  );
  if (unknown.length > 0) {
    throw new Error(
      `BULLMQ_QUEUE_NAMES contains queues not declared at install time: ${unknown.join(", ")}. Install-time queues: ${INSTALL_QUEUE_NAMES.join(", ")}.`,
    );
  }
  return parsed as QueueName[];
}

export const QUEUE_NAMES = resolveRuntimeQueueNames();

const queues = new Map<QueueName, Queue>();

function getQueueInternal(name: QueueName): Queue {
  // Fallback mode means Redis is unreachable; addJob() routes to the
  // in-process executor instead. Handing out a Queue here would let a
  // caller bypass the fallback contract and enqueue into BullMQ's still-
  // open client, where the writes would either time out or pile up
  // waiting for a reconnect that never comes. Force callers through
  // addJob() so the routing decision stays in one place.
  if (isFallbackActive()) {
    throw new Error(
      `getQueue('${name}'): fallback mode is active. Use addJob() so the in-process executor is used automatically.`,
    );
  }
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
