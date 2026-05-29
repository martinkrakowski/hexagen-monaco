# Template: BullMQ

**Branch:** `feature/generator-template-bullmq`

## Purpose

Generates a fully typed BullMQ job queue with worker setup, job type definitions, Redis connection management, graceful fallback to in-process execution when Redis is unavailable, and optional Bull Board dashboard. Designed for background processing (image generation, email, webhooks, exports) in projects where tasks are too slow for request/response cycles.

---

## Install-Time Questions

| ID                 | Prompt                                | Type        | Options                                                           | Default                        |
| ------------------ | ------------------------------------- | ----------- | ----------------------------------------------------------------- | ------------------------------ |
| `worker_mode`      | Where does the worker run?            | select      | `same-process`, `separate-service`                                | `same-process`                 |
| `queue_names`      | Queue names (comma-separated)?        | text        | —                                                                 | `default,images,notifications` |
| `job_examples`     | Generate example job types?           | multiselect | `image-processing`, `email`, `webhook`, `export`, `ai-generation` | `default`                      |
| `redis_source`     | Redis connection?                     | select      | `local`, `redis-cloud`, `upstash`, `docker-compose`               | `local`                        |
| `bull_board`       | Include Bull Board web dashboard?     | boolean     | —                                                                 | `true`                         |
| `supabase_results` | Store job results in Supabase?        | boolean     | — (only shown if supabase installed)                              | `false`                        |
| `concurrency`      | Default worker concurrency per queue? | select      | `1`, `2`, `5`, `10`                                               | `2`                            |

---

## Files Generated

```
src/
  infrastructure/
    queue/
      connection.ts           # Redis connection factory with fallback detection
      queues.ts               # Typed queue instances per queue name
      workers/
        <queue-name>.worker.ts   # One worker file per queue
      jobs/
        <job-type>.job.ts     # Type definition + handler for each job type
      scheduler/
        job-scheduler.ts      # Add recurring/cron jobs
      fallback/
        sync-executor.ts      # In-process fallback when Redis unavailable
      result-store/
        job-result.ts         # Optional: persist job result to Supabase
      errors/
        job-errors.ts
      index.ts                # Barrel: exports addJob, getQueue, etc.

server/
  startup/
    start-workers.ts          # Called at server startup (same-process mode)

app/
  api/
    bull-board/               # (if bull_board=true)
      [[...slug]]/
        route.ts              # Bull Board Next.js adapter

scripts/
  start-worker.ts             # Entrypoint for separate-service mode

.env.bullmq.example
```

---

## Generated .env Variables

```env
# BullMQ / Redis
REDIS_URL=redis://localhost:6379
REDIS_MAX_RETRIES=3
REDIS_CONNECTION_TIMEOUT_MS=5000
BULLMQ_FALLBACK_MODE=auto      # auto | always | never
                                # auto = use in-process if Redis unavailable

# Bull Board (if enabled)
BULL_BOARD_ENABLED=true
BULL_BOARD_BASE_PATH=/admin/queues
BULL_BOARD_USERNAME=admin
BULL_BOARD_PASSWORD=            # Set in production

# Worker
WORKER_CONCURRENCY=2
```

---

## Key Design Decisions

**`worker_mode=same-process`** is the default because it works without any process manager or separate deploy step — ideal for demos and early-stage projects. Switching to `separate-service` means pointing `start-worker.ts` at a separate process (PM2, Railway worker, Fly Machine) without changing job or queue code.

**Graceful Redis fallback:** When `BULLMQ_FALLBACK_MODE=auto` and Redis is unreachable at startup, the queue layer automatically routes `addJob()` calls to `sync-executor.ts`, which runs the job handler synchronously in the same request. This means the app works without Redis during local development. A warning is logged so developers know they're in fallback mode.

**One worker file per queue:** This makes concurrency, error handling, and job routing easy to reason about. The worker files are thin — they import job handlers from `jobs/` and delegate.

**Job handlers are pure functions:** Each `<job-type>.job.ts` exports a `process(job: Job<JobData>): Promise<JobResult>` function with no side effects on the queue itself. This makes handlers unit-testable without a Redis connection.

**Bull Board is protected:** In production, the `/admin/queues` route requires `BULL_BOARD_USERNAME` + `BULL_BOARD_PASSWORD` via HTTP Basic Auth. In development, it's open. The middleware checks `NODE_ENV`.

---

## Phase 1 — Redis Connection Factory

**Goal:** Single place that manages the Redis connection lifecycle.

```typescript
// src/infrastructure/queue/connection.ts
export function createRedisConnection(): {
  connection: Redis | null;
  isFallback: boolean;
};
```

- Attempts connection to `REDIS_URL`
- On `ECONNREFUSED` or timeout: returns `{ connection: null, isFallback: true }`
- In `isFallback=true` state: logs a warning once at startup
- Exports `isRedisAvailable(): boolean` for health check

Validation: Unit test with mocked `ioredis` — assert fallback path triggers on connection failure.

---

## Phase 2 — Typed Queue Definitions

**Goal:** Type-safe queue instances, one per configured queue name.

```typescript
// src/infrastructure/queue/queues.ts
import { Queue } from "bullmq";

export type QueueName = "default" | "images" | "notifications";

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  if (!queues.has(name)) {
    queues.set(name, new Queue(name, { connection }));
  }
  return queues.get(name)!;
}

export async function addJob<T>(
  queue: QueueName,
  jobName: string,
  data: T,
  opts?: JobsOptions,
): Promise<Job<T>>;
```

Validation: TypeScript — `addJob('unknown-queue', ...)` produces a compile error.

---

## Phase 3 — Job Type Definitions & Handlers

**Goal:** Typed job data, one handler per job type.

Example for `ai-generation` job:

```typescript
// src/infrastructure/queue/jobs/ai-generation.job.ts
export interface AIGenerationJobData {
  projectId: string;
  prompt: string;
  model: string;
  callbackUrl?: string;
}

export interface AIGenerationJobResult {
  generatedContent: string;
  tokenUsage: { prompt: number; completion: number };
}

export async function processAIGenerationJob(
  job: Job<AIGenerationJobData>,
): Promise<AIGenerationJobResult>;
```

One file per selected `job_examples`. Each file is independent; the worker imports and routes to the correct handler.

Validation: Unit test for each handler with mocked dependencies.

---

## Phase 4 — Worker Setup

**Goal:** Workers that import handlers, log progress, and handle errors correctly.

Worker pattern:

```typescript
// src/infrastructure/queue/workers/images.worker.ts
const worker = new Worker<ImageJobData>(
  "images",
  async (job) => {
    job.log(`Processing ${job.name} for projectId=${job.data.projectId}`);
    job.updateProgress(10);
    const result = await processImageJob(job);
    job.updateProgress(100);
    return result;
  },
  { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2) },
);

worker.on("failed", (job, err) =>
  logger.error("Job failed", { jobId: job?.id, err }),
);
worker.on("error", (err) => logger.error("Worker error", { err }));
```

`server/startup/start-workers.ts` imports all worker files and calls `gracefulShutdown()` on `SIGTERM`.

Validation: Integration test — add a job, wait for completion, assert result matches.

---

## Phase 5 — In-Process Fallback

**Goal:** Seamless degradation when Redis is unavailable.

```typescript
// src/infrastructure/queue/fallback/sync-executor.ts
export async function executeSync<T, R>(
  jobName: string,
  data: T,
  handler: (data: T) => Promise<R>,
): Promise<R>;
```

`addJob()` in `queues.ts` checks `isRedisAvailable()`:

- `true` → enqueue normally in BullMQ
- `false` → call `executeSync()` directly, return a fake `Job`-like object

Log line on fallback: `[bullmq:fallback] Redis unavailable — running job synchronously: ${jobName}`

Validation: Unit test with `REDIS_URL` unset — assert job handler is called synchronously.

---

## Phase 6 — Bull Board Dashboard (opt-in)

**Goal:** Working queue monitoring UI at `/admin/queues`.

Install: `@bull-board/nextjs`, `@bull-board/api`

`app/api/bull-board/[[...slug]]/route.ts`:

- Registers all queues with Bull Board
- Wraps with Basic Auth middleware in production
- Returns `serverAdapter.getRouter()` as Next.js route handler

Validation: `curl -u admin:password http://localhost:3000/admin/queues` returns 200 with HTML.

---

## Phase 7 — Job Scheduler (Recurring Jobs)

**Goal:** Cron-style recurring job definitions managed in code (not manually via CLI).

```typescript
// src/infrastructure/queue/scheduler/job-scheduler.ts
export async function scheduleRecurringJobs(): Promise<void> {
  const queue = getQueue("default");
  // Remove stale repeatable jobs before re-registering
  for (const job of await queue.getRepeatableJobs()) {
    await queue.removeRepeatableByKey(job.key);
  }
  await queue.add("daily-cleanup", {}, { repeat: { cron: "0 2 * * *" } });
}
```

Called from `start-workers.ts` at startup. This ensures recurring job definitions stay in sync with code without manual Redis state management.

Validation: Unit test with mocked queue — assert `add` called with correct cron string.

---

## Phase 8 — Supabase Job Result Store (opt-in)

**Goal:** Persist job outcomes to Supabase for long-running operation status polling.

Only generated when both `supabase` and `supabase_results=true` are active.

```typescript
// src/infrastructure/queue/result-store/job-result.ts
export type JobStatus = "pending" | "processing" | "completed" | "failed";

export async function createJobRecord(
  jobId: string,
  type: string,
  data: unknown,
): Promise<void>;
export async function updateJobStatus(
  jobId: string,
  status: JobStatus,
  result?: unknown,
): Promise<void>;
export async function getJobResult(jobId: string): Promise<JobRecord | null>;
```

Migration stub: `supabase/migrations/0002_job_results.sql`

Validation: Unit test for status transitions; integration test for Supabase write/read.

---

## Post-Install Checklist

```
✅ bullmq installed

Next steps:
  1. Merge .env.bullmq.example into .env.local
  2. Start Redis locally: redis-server  (or: docker compose up redis)
  3. If BULLMQ_FALLBACK_MODE=auto, app works without Redis — check logs for [bullmq:fallback] warnings
  4. Visit http://localhost:3000/admin/queues for Bull Board (if enabled)
  5. In same-process mode: workers start automatically with the Next.js server
  6. In separate-service mode: run: node --import tsx/esm scripts/start-worker.ts
  7. See SETUP.md → BullMQ for Redis Cloud and Upstash connection strings
```

---

## Template Dependencies

- Required: `env-setup`
- Soft dependency: `observability` (structured worker error logging)
- Soft dependency: `docker` (adds Redis service to docker-compose)
- Soft dependency: `supabase` (enables Supabase job result store)
