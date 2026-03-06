import type { Logger } from '@hexagen/arch-linter';
import { createConsoleLogger } from '@hexagen/arch-linter';

export interface SyncConfig {
  force: boolean;
  forceRoot: boolean;
  dryRun: boolean;
  strict: boolean;
  logger: Logger;
}

export function parseArgs(rawArgs: string[]): SyncConfig {
  const args = rawArgs.slice(2);

  const config: SyncConfig = {
    force: false,
    forceRoot: false,
    dryRun: false,
    strict: false,
    logger: createConsoleLogger(false),
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--force':
      case '-f':
        config.force = true;
        break;

      case '--force-root':
        config.forceRoot = true;
        break;

      case '--dry-run':
      case '--dry':
        config.dryRun = true;
        break;

      case '--strict':
        config.strict = true;
        break;

      default:
        if (arg.startsWith('-')) {
          config.logger.warn(`Unknown flag ignored: ${arg}`);
        }
        break;
    }
  }

  return config;
}
