import IORedis, { type Redis } from "ioredis";

// Single Redis connection used by all queues + workers. We probe it once at
// module load: if the URL is unreachable or REDIS_URL is unset, the queue
// layer routes addJob() calls to the in-process fallback executor instead
// of throwing — local dev works without Redis, and a single warning is
// logged so the mode is visible.

const REDIS_URL = process.env.REDIS_URL ?? "";
const MAX_RETRIES = Number(process.env.REDIS_MAX_RETRIES ?? 3);
const CONNECT_TIMEOUT_MS = Number(process.env.REDIS_CONNECTION_TIMEOUT_MS ?? 5000);
const FALLBACK_MODE = process.env.BULLMQ_FALLBACK_MODE ?? "auto";

let connection: Redis | null = null;
let fallbackActive = false;
let warned = false;

function announceFallback(reason: string): void {
  if (warned) return;
  warned = true;
  // eslint-disable-next-line no-console
  console.warn(
    `[bullmq:fallback] Redis unavailable (${reason}) — running jobs synchronously in-process. Set BULLMQ_FALLBACK_MODE=never to disable.`,
  );
}

// "never" forces real Redis even if it errors; "always" forces fallback.
// "auto" (default) tries Redis once and falls back on failure.
if (FALLBACK_MODE === "always") {
  fallbackActive = true;
} else if (!REDIS_URL && FALLBACK_MODE === "auto") {
  fallbackActive = true;
  announceFallback("REDIS_URL not set");
} else if (REDIS_URL) {
  try {
    connection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null, // BullMQ requires null here
      enableReadyCheck: true,
      connectTimeout: CONNECT_TIMEOUT_MS,
      retryStrategy: (times) => (times >= MAX_RETRIES ? null : Math.min(times * 200, 2000)),
    });
    connection.on("error", (err) => {
      if (FALLBACK_MODE === "auto") {
        fallbackActive = true;
        announceFallback(err.message);
      }
    });
  } catch (err) {
    if (FALLBACK_MODE === "auto") {
      fallbackActive = true;
      announceFallback(err instanceof Error ? err.message : String(err));
    } else {
      throw err;
    }
  }
}

export function getRedisConnection(): Redis | null {
  return connection;
}

export function isRedisAvailable(): boolean {
  return connection !== null && !fallbackActive;
}

export function isFallbackActive(): boolean {
  return fallbackActive;
}

export async function disconnectRedis(): Promise<void> {
  if (connection) {
    await connection.quit().catch(() => undefined);
    connection = null;
  }
}
