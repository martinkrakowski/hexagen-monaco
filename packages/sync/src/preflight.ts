// preflight.ts – ensure dependencies are built before sync
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { SyncConfig } from "./config.js";

const execAsync = promisify(exec);

/**
 * Runs a full build for all packages that have stale source files.
 * For simplicity we invoke the monorepo turbo build which will rebuild any out‑of‑date packages.
 */
export async function ensureDependenciesBuilt(
  config: SyncConfig,
): Promise<void> {
  const { logger } = config;
  logger.info("Pre‑flight: ensuring package dependencies are up‑to‑date...");
  try {
    // Turbo will only rebuild packages that need it based on timestamps.
    const { stdout, stderr } = await execAsync("yarn turbo run build");
    if (stdout) logger.debug(stdout);
    if (stderr) logger.warn(stderr);
    logger.info("Pre‑flight build completed.");
  } catch (err) {
    logger.error(
      `Pre‑flight build failed: ${err instanceof Error ? err.message : err}`,
    );
    throw err;
  }
}
