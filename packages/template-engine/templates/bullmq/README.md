# BullMQ (`bullmq`)

> Typed BullMQ job queues with workers, a scheduler, a Redis→in-process fallback, an optional
> Bull Board dashboard, and per-queue routing. For background work too slow for request/response.

|               |                                     |
| ------------- | ----------------------------------- |
| **ID**        | `bullmq`                            |
| **Category**  | Persistence / background jobs       |
| **Requires**  | `env-setup`                         |
| **Conflicts** | none                                |
| **Branch**    | `feature/generator-template-bullmq` |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Sets up typed queues + workers over Redis, with a graceful fallback to synchronous in-process
execution when Redis is absent (dev-friendly), a recurring-job scheduler defined in code, and an
optional admin dashboard. Good for image generation, email, webhooks, exports, AI generation.

## What it scaffolds

- `src/infrastructure/queue/{connection,queues,workers,index}.ts`, `fallback/sync-executor.ts`,
  `scheduler/job-scheduler.ts`.
- `server/startup/start-workers.ts` (always emitted), plus `scripts/start-worker.ts` when `worker_mode=separate-service`.
- Optional Bull Board route; optional example jobs (image-processing/email/webhook/export/ai-generation).

## Install

`hexagen add bullmq`. Questions: `worker_mode` (`same-process`/`separate-service`), `queue_names`,
`job_examples` (multiselect), `redis_source`, `concurrency`, `bull_board` (bool).

Env: `REDIS_URL`, `REDIS_MAX_RETRIES`, `REDIS_CONNECTION_TIMEOUT_MS`, `BULLMQ_FALLBACK_MODE`,
`BULLMQ_QUEUE_NAMES`, `WORKER_CONCURRENCY`, `WEBHOOK_FETCH_TIMEOUT_MS`, `BULL_BOARD_*`.

## Usage

```ts
import { addJob } from "@/infrastructure/queue";

await addJob("images", "upscale", { inputHref, outputHref }); // routes by job.name to its handler
```

## Notes for agents

- `npm install bullmq ioredis` (+ `@bull-board/nextjs @bull-board/api` if dashboard enabled).
- `BULLMQ_FALLBACK_MODE=auto` runs without Redis (watch for `[bullmq:fallback]` warnings).
- Same-process: import `start-workers.ts` at startup. Separate-service: run `scripts/start-worker.ts`
  on a worker machine (don't import the same-process file).
- Set `BULL_BOARD_USERNAME`/`PASSWORD` before production.

## Checklist (post-install)

Install deps; merge env; start Redis; choose worker mode + wiring; secure Bull Board; add jobs via
`addJob`; define recurring jobs in `job-scheduler.ts`.

## Related

Requires [`env-setup`](../env-setup). Fans out per-asset work for the Adobe Firefly services
(e.g. [`adobe-lightroom`](../adobe-lightroom)).
