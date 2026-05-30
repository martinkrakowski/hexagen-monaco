/**
 * Separate-service worker entrypoint. Run on a dedicated worker dyno /
 * machine / container with:
 *
 *   node --import tsx/esm scripts/start-worker.ts
 *
 * Same-process consumers should import bootstrapWorkers from
 * server/startup/start-workers.ts instead — this file is the standalone
 * binary equivalent for deployments that want workers isolated from the
 * web server.
 */
import { bootstrapWorkers } from "../server/startup/start-workers";

async function main(): Promise<void> {
  await bootstrapWorkers();
  // eslint-disable-next-line no-console
  console.log("[bullmq:worker] up");
  // Keep the process alive — workers are event-driven, not request-driven.
  // The SIGINT/SIGTERM handlers installed by bootstrapWorkers shut down
  // cleanly on signal.
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[bullmq:worker] fatal", err);
  process.exit(1);
});
