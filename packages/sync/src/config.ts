import type { Logger } from '@hexagen/arch-linter';
import { createConsoleLogger } from '@hexagen/arch-linter';
import type { Manifest } from './types/manifest';

// Flags-only (what parseArgs can provide)
export interface SyncFlags {
  dryRun: boolean;
  force: boolean;
  forceRoot: boolean;
  strict: boolean;
  logger: Logger;
}

// Full runtime config (after augmentation)
export interface SyncConfig extends SyncFlags {
  manifest: Manifest;
  workspaceRoot: string;
}

export function parseArgs(rawArgs: string[]): SyncFlags {
  const args = rawArgs.slice(2);

  const flags: SyncFlags = {
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
        flags.force = true;
        break;

      case '--force-root':
        flags.forceRoot = true;
        break;

      case '--dry-run':
      case '--dry':
        flags.dryRun = true;
        break;

      case '--strict':
        flags.strict = true;
        break;

      default:
        if (arg.startsWith('-')) {
          flags.logger.warn(`Unknown flag ignored: ${arg}`);
        }
        break;
    }
  }

  return flags;
}
