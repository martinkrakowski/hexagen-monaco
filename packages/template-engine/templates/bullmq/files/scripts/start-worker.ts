/**
 * Separate-service worker entrypoint. Run on a dedicated worker dyno /
 * machine / container with:
 *
 *   node --import tsx/esm scripts/start-worker.ts
 *
 * This file OWNS its process, so it installs SIGINT/SIGTERM handlers that
 * call `shutdownWorkers()` and exit cleanly. Same-process consumers
 * (Next.js custom server, `instrumentation.ts`) must NOT use this file —
 * they import `bootstrapWorkers` + `shutdownWorkers` from
 * server/startup/start-workers.ts and wire them into the host process's
 * existing lifecycle, so the web server's own graceful shutdown stays in
 * charge of HTTP draining.
 */
import {
  bootstrapWorkers,
  shutdownWorkers,
} from "../server/startup/start-workers";

let shuttingDown = false;

async function gracefulExit(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  // eslint-disable-next-line no-console
  console.log(`[bullmq:worker] ${signal} received, shutting down…`);
  try {
    await shutdownWorkers();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[bullmq:worker] error during shutdown", err);
  }
  process.exit(0);
}

async function main(): Promise<void> {
  // Register signal handlers BEFORE awaiting bootstrap so a SIGINT/SIGTERM
  // received during startup (e.g. a long Redis handshake under a container
  // health-check that decides to kill the worker) still routes through
  // gracefulExit() instead of slamming the process with the default handler.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void gracefulExit(signal);
    });
  }
  await bootstrapWorkers();
  // eslint-disable-next-line no-console
  console.log("[bullmq:worker] up");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[bullmq:worker] fatal", err);
  process.exit(1);
});
