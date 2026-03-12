// preflight.ts – ensure dependencies are built before sync
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { SyncConfig } from "./config.js";

const execAsync = promisify(exec);

// 10MB buffer to handle turbo's verbose output
const MAX_BUFFER = 1024 * 1024 * 10;

/**
 * Runs a full build for all packages that have stale source files.
 * For simplicity we invoke the monorepo turbo build which will rebuild any out‑of‑date packages.
 */
export async function ensureDependenciesBuilt(
  config: SyncConfig,
): Promise<void> {
  const { logger, dryRun } = config;

  if (dryRun) {
    logger.info("Pre‑flight: skipping build in dry-run mode");
    return;
  }

  logger.info("Pre‑flight: ensuring package dependencies are up‑to‑date...");
  try {
    // Turbo will only rebuild packages that need it based on timestamps.
    const { stdout, stderr } = await execAsync("npx turbo run build", {
      maxBuffer: MAX_BUFFER,
    });
    if (stdout) logger.debug(stdout);
    if (stderr) logger.warn(stderr);
    logger.info("Pre‑flight build completed.");
  } catch (err: any) {
    // Include actual error output for debugging
    const errorDetails = err.stderr || err.stdout || err.message || err;
    logger.error(`Pre‑flight build failed: ${errorDetails}`);
    throw err;
  }
}
