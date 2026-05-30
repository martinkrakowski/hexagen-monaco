# Template: BullMQ

**Branch:** `feature/generator-template-bullmq`
**Status:** Implemented (v1.0). 15 outputs (7 gated), 6 questions. See PR for details.

## What shipped vs. the plan

The plan called for 8 phases. v1 ships 7:

- **Phases 1, 2, 5 (always emit):** Redis connection factory with auto/always/never fallback modes; typed `addJob` / `getQueue` / `registerFallbackHandler` API; in-process sync executor that returns BullMQ-shaped Job stubs so consumer code is identical in either mode.
- **Phase 3 (gated per example):** Five opt-in job files — `image-processing`, `email`, `webhook`, `export`, `ai-generation` — each gated on `job_examples` including the matching value. Per-file emission preserves the plan's "one handler file per type" pattern.
- **Phase 4 (always):** Single `workers.ts` that iterates `QUEUE_NAMES` and dispatches by `job.name` through a registered handler map. Deviates from the plan's "one worker file per queue" only because the template engine doesn't support templated paths in outputs; the dispatcher-table approach is structurally cleaner and lets handlers be registered in any order at boot.
- **Phase 6 (gated on `bull_board`):** Bull Board mounted at `BULL_BOARD_BASE_PATH` with HTTP Basic Auth in production, 503 in fallback mode.
- **Phase 7 (always):** Recurring-job scheduler that re-registers all definitions idempotently every startup and prunes stale schedules — kills the classic "I changed the cron but the old one is still running in Redis" trap.
- **Same-process / separate-service split:** `server/startup/start-workers.ts` always emits; `scripts/start-worker.ts` is gated on `worker_mode=separate-service`.

**Phase 8 (Supabase job result store) is deferred** — it requires a soft dependency on the supabase template plus a migration, which is non-trivial to coordinate. Tracked separately; the existing `addJob` API leaves the door open for a result-store wrapper to land later without breaking callers.

## Test coverage

`packages/template-engine/__tests__/templates/bullmq-emit-shape.test.ts` exercises two install scenarios end-to-end against the real template directory:

- minimal install (defaults) — asserts the 8 always-on files emit, plus the bull-board route; asserts neither `start-worker.ts` nor any `jobs/*.job.ts` appear.
- full install (separate-service + all five job examples + `bull_board=false`) — asserts the separate-service entrypoint emits, all five job files emit, and the bull-board route is absent.

The supabase emit-shape test in the same directory exercises the cross-cutting "templates that adapt to answers" guarantee for Supabase; the bullmq test does the same for BullMQ, giving us hard regression guards on both the most-gated templates.

---

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

## Files Generated (as shipped in v1.0)

```text
src/
  infrastructure/
    queue/
      connection.ts                       # Redis factory with auto/always/never fallback + recover-on-reconnect
      queues.ts                           # addJob(queue, jobName, data) + getQueue() + fallback handler registry
      workers.ts                          # Single worker dispatcher: iterates QUEUE_NAMES, routes by job.name
      fallback/
        sync-executor.ts                  # Inline executor; passes a real BullMQ-shaped Job mock to handlers
      scheduler/
        job-scheduler.ts                  # Recurring jobs in code; prunes stale schedules every startup
      jobs/
        image-processing.job.ts           # (gated: job_examples includes "image-processing")
        email.job.ts                      # (gated: job_examples includes "email")
        webhook.job.ts                    # (gated: job_examples includes "webhook")
        export.job.ts                     # (gated: job_examples includes "export")
        ai-generation.job.ts              # (gated: job_examples includes "ai-generation")
      index.ts                            # Barrel: addJob, QUEUE_NAMES, etc.

server/
  startup/
    start-workers.ts                      # bootstrapWorkers() / shutdownWorkers() — host installs lifecycle hooks

app/
  admin/
    queues/[[...slug]]/route.ts           # (gated on bull_board=true) Basic-Auth-protected in production; URL matches BULL_BOARD_BASE_PATH default

scripts/
  start-worker.ts                         # (gated on worker_mode=separate-service) standalone worker process

.env.bullmq.example
```

### Differences from the original plan

The original plan envisioned per-queue worker files (`workers/<queue-name>.worker.ts`) and per-job-type handler files (`jobs/<job-type>.job.ts`). The engine doesn't support templated paths for outputs, so v1 ships:

- **One `workers.ts`** that iterates `QUEUE_NAMES` and dispatches by `job.name` through a registered handler map. Adding a new queue is an env-var change, not a code generation step.
- **Per-job-type files** as planned — each is gated on `job_examples includes "<name>"`, so picking the example set toggles individual files on/off.
- **Plus**: each job file exports a `<NAME>_DEFAULT_QUEUE` constant so `start-workers.ts` can register the handler on the appropriate queue (image-processing → "images"; the rest → "default"), with fallback to the first enabled queue if the declared one isn't configured.

A `result-store/` / Supabase result persistence layer was deferred to a separate follow-up because it needs a soft dep on the supabase template plus a migration; the `addJob` API leaves the door open for a wrapper to land later without breaking callers. A dedicated `errors/job-errors.ts` was inlined into `queues.ts` — too small to justify its own file.

---

## Generated .env Variables

```env
# BullMQ / Redis
REDIS_URL=redis://localhost:6379
REDIS_MAX_RETRIES=3
REDIS_CONNECTION_TIMEOUT_MS=5000
BULLMQ_FALLBACK_MODE=auto      # auto | always | never
                                # auto = in-process executor if Redis unavailable; recovers on reconnect
BULLMQ_QUEUE_NAMES=default,images,notifications  # overrides the install-time default

# Bull Board (if enabled)
BULL_BOARD_ENABLED=true
BULL_BOARD_BASE_PATH=/admin/queues
BULL_BOARD_USERNAME=admin
BULL_BOARD_PASSWORD=            # Required in production; Basic Auth via timingSafeEqual

# Worker
WORKER_CONCURRENCY=2
```

---

## Key Design Decisions

**`worker_mode=same-process`** is the default because it works without any process manager or separate deploy step — ideal for demos and early-stage projects. Switching to `separate-service` means pointing `scripts/start-worker.ts` at a separate process (PM2, Railway worker, Fly Machine) without changing job or queue code.

**Graceful Redis fallback with auto-recovery:** When `BULLMQ_FALLBACK_MODE=auto` and Redis is unreachable at startup or transitions to an `error` state, the queue layer routes `addJob()` calls to `sync-executor.ts`. When ioredis subsequently fires `ready` or `connect` (after a Redis restart / network blip), the fallback flag is cleared and the queue resumes pushing to BullMQ — so a transient outage doesn't permanently degrade the app until process restart.

**Process lifecycle is the host's responsibility in same-process mode.** `start-workers.ts` exposes `bootstrapWorkers()` and `shutdownWorkers()` but does NOT install SIGINT/SIGTERM handlers — registering them inside the web server's process would hijack Next.js's own graceful HTTP shutdown and drop in-flight requests. Wire `shutdownWorkers()` into the host's existing exit hook. The separate-service entrypoint `scripts/start-worker.ts` installs its own signal handlers because it owns the process.

**Single dispatcher with per-job queue affinity:** `workers.ts` runs one BullMQ Worker per `QUEUE_NAMES` entry and dispatches by `job.name` to a registered handler. Each job file declares its preferred queue via a `<NAME>_DEFAULT_QUEUE` constant; `start-workers.ts` honours that affinity (or falls through to the first enabled queue if the declared one isn't configured).

**Fallback executor passes a real Job mock:** `executeSync()` constructs a Job-shaped object with `id`, `log()`, `updateProgress()`, etc. and passes it to the handler — same signature as the BullMQ worker callback path. Consumer code is identical in either mode; no per-handler wrappers, no `as never` casts at the call site.

**Job handlers are pure functions:** Each `<job-type>.job.ts` exports a `process(job: Job<JobData>): Promise<JobResult>` function with no side effects on the queue itself. Unit-testable without a Redis connection.

**Bull Board uses constant-time auth:** In production, the `/admin/queues` route requires `BULL_BOARD_USERNAME` + `BULL_BOARD_PASSWORD` via HTTP Basic Auth, compared with `crypto.timingSafeEqual` so the response time doesn't leak which side mismatched. In development the route is open. In fallback mode it returns 503 rather than rendering an empty board.

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

`app/admin/queues/[[...slug]]/route.ts` (so Next.js serves it at `/admin/queues/...`, matching the Bull Board adapter's default `basePath`):

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
