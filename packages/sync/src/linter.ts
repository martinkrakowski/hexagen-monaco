import { promisify } from "node:util";
import { exec } from "node:child_process";
import type { SyncConfig } from "./config.js";

const execPromise = promisify(exec);

/**
 * Runs the architectural integrity linter (extracted from old arch-linter sync.ts).
 * Now fully config-driven and crash-proof.
 */
export async function runArchLinter(config: SyncConfig): Promise<void> {
  const { logger, strict, dryRun } = config;

  logger.info("Running Architectural Integrity Linter...");

  if (dryRun) {
    logger.info("[DRY-RUN] would run arch-linter");
    return;
  }

  try {
    // Installed arch-linter bin (scope-agnostic) — works in this monorepo and
    // in a generated project (via the @hexagen-monaco/arch-linter devDep),
    // unlike `yarn workspace …` which only resolves here.
    const { stdout, stderr } = await execPromise(
      "node_modules/.bin/hexagen-lint",
      { cwd: config.workspaceRoot },
    );

    if (stdout) logger.info(stdout.trim());
    if (stderr) logger.error(stderr.trim());

    logger.info("✅ Architecture is compliant with manifest.yaml.");
  } catch (error: unknown) {
    const message =
      (error instanceof Error &&
        "stderr" in error &&
        (error as { stderr?: string }).stderr) ||
      (error instanceof Error && error.message) ||
      "Unknown linter error";
    logger.error(`Architectural Integrity Check Failed:\n${message}`);

    if (strict) {
      throw new Error("Arch-linter failed in strict mode");
    }
  }
}
