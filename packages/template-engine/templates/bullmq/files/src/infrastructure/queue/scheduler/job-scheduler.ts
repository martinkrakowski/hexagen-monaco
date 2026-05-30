import { getQueue, QUEUE_NAMES } from "../queues";
import { isFallbackActive } from "../connection";

/**
 * Definitions for recurring jobs. Edit this list in code — schedules are
 * re-registered idempotently every time `scheduleRecurringJobs()` runs
 * (typically at process startup, via server/startup/start-workers.ts), and
 * any stale repeatable jobs that are no longer in this list are pruned.
 * That avoids the classic BullMQ trap where a cron change leaves the old
 * schedule running in Redis forever.
 */
interface RecurringJob {
  queue: (typeof QUEUE_NAMES)[number];
  jobName: string;
  pattern: string; // Cron expression
  data?: Record<string, unknown>;
}

const RECURRING_JOBS: RecurringJob[] = [
  // Example: a nightly cleanup at 02:00.
  // {
  //   queue: "default",
  //   jobName: "daily-cleanup",
  //   pattern: "0 2 * * *",
  //   data: { mode: "soft" },
  // },
];

export async function scheduleRecurringJobs(): Promise<void> {
  if (isFallbackActive()) {
    // eslint-disable-next-line no-console
    console.warn(
      "[bullmq:scheduler] fallback mode active — recurring jobs are not registered (no Redis).",
    );
    return;
  }

  // Group by queue so we make one repeatable-jobs round-trip per queue,
  // not one per definition.
  const desiredByQueue = new Map<string, RecurringJob[]>();
  for (const def of RECURRING_JOBS) {
    const list = desiredByQueue.get(def.queue) ?? [];
    list.push(def);
    desiredByQueue.set(def.queue, list);
  }

  for (const queueName of QUEUE_NAMES) {
    const queue = getQueue(queueName);
    const desired = desiredByQueue.get(queueName) ?? [];
    const desiredKeys = new Set(
      desired.map((d) => `${d.jobName}:${d.pattern}`),
    );

    // Prune any stale schedules not in the current desired set.
    const existing = await queue.getRepeatableJobs();
    for (const job of existing) {
      const key = `${job.name}:${job.pattern}`;
      if (!desiredKeys.has(key)) {
        await queue.removeRepeatableByKey(job.key);
      }
    }

    // Register everything in the desired set; BullMQ dedupes by pattern + name.
    for (const def of desired) {
      await queue.add(def.jobName, def.data ?? {}, {
        repeat: { pattern: def.pattern },
      });
    }
  }
}
