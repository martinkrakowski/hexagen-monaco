import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import type { SyncConfig } from './config.js';

const execPromise = promisify(exec);

/**
 * Runs the architectural integrity linter (extracted from old arch-linter sync.ts).
 * Now fully config-driven and crash-proof.
 */
export async function runArchLinter(config: SyncConfig): Promise<void> {
  const { logger, strict, dryRun } = config;

  logger.info('Running Architectural Integrity Linter...');

  if (dryRun) {
    logger.info('[DRY-RUN] would run arch-linter');
    return;
  }

  try {
    const { stdout, stderr } = await execPromise(
      'yarn workspace @hexagen/arch-linter lint:arch'
    );

    if (stdout) logger.info(stdout.trim());
    if (stderr) logger.error(stderr.trim());

    logger.info('✅ Architecture is compliant with architecture.yaml.');
  } catch (error: any) {
    const message = error.stderr || error.message || 'Unknown linter error';
    logger.error(`Architectural Integrity Check Failed:\n${message}`);

    if (strict) {
      throw new Error('Arch-linter failed in strict mode');
    }
  }
}
