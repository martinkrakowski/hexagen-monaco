// Barrel — re-exports the consumer-facing surface for the queue layer.
// Consumer code should import `addJob`, `QUEUE_NAMES`, etc. from here rather
// than from individual files so internal restructuring stays invisible.

export {
  addJob,
  closeAllQueues,
  getQueue,
  QUEUE_NAMES,
  registerFallbackHandler,
  type QueueName,
} from "./queues";

export {
  registerJobHandler,
  startWorkers,
  stopWorkers,
} from "./workers";

export {
  disconnectRedis,
  getRedisConnection,
  isFallbackActive,
  isRedisAvailable,
  parseIntEnv,
} from "./connection";

export { scheduleRecurringJobs } from "./scheduler/job-scheduler";

export type { SyncJob } from "./fallback/sync-executor";
