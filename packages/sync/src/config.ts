import type { Manifest } from "./types/manifest.js";
import { type LoggerPort, type LoggerConfig } from "@hexagen/shared";

export type { LoggerPort, LoggerConfig };

const internalLogger: LoggerPort = {
  error: (msg) => console.error(`[sync] ${msg}`),
  warn: (msg) => console.warn(`[sync] ${msg}`),
  info: (msg) => console.log(`[sync] ${msg}`),
  debug: (msg) => {
    if (process.env.DEBUG) console.log(`[debug] ${msg}`);
  },
  errorWithException: (err, msg) => {
    const errorMessage =
      msg ?? (err instanceof Error ? err.message : String(err));
    console.error(`[sync] ${errorMessage}`);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
  },
};

// Flags-only (what parseArgs can provide)
export interface SyncFlags {
  dryRun: boolean;
  force: boolean;
  forceRoot: boolean;
  allowDirty: boolean;
  strict: boolean;
  /** Mode is set programmatically (not via CLI). Use 'self-regen' for CLI, 'external' for API-driven generation */
  mode: "self-regen" | "external";
  logger: LoggerPort;
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
    allowDirty: false,
    dryRun: false,
    strict: false,
    mode: "self-regen",
    logger: internalLogger,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--force":
      case "-f":
        flags.force = true;
        break;

      case "--force-root":
        flags.forceRoot = true;
        break;

      case "--dry-run":
      case "--dry":
        flags.dryRun = true;
        break;

      case "--strict":
        flags.strict = true;
        break;

      case "--allow-dirty":
        flags.allowDirty = true;
        break;

      default:
        if (arg.startsWith("-")) {
          flags.logger.warn(`Unknown flag ignored: ${arg}`);
        }
        break;
    }
  }

  return flags;
}
