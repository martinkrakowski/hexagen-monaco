import type { Manifest } from "./types/manifest.js";
import { LogLevel, type LoggerPort, type LoggerConfig } from "@hexagen/shared";

export type { LoggerPort, LoggerConfig };

interface LoggerOptions {
  minLevel?: LogLevel;
  includeTimestamps?: boolean;
}

function createPrefixedLogger(
  prefix: string,
  options: LoggerOptions = {},
): LoggerPort {
  const minLevel = options.minLevel ?? LogLevel.INFO;
  const includeTimestamps = options.includeTimestamps ?? true;

  const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
  const currentLevelIndex = levels.indexOf(minLevel);

  function shouldLog(level: LogLevel): boolean {
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex >= currentLevelIndex;
  }

  function formatMessage(level: LogLevel, message: string): string {
    const timestamp = includeTimestamps ? new Date().toISOString() : "";
    return timestamp
      ? `${timestamp} [${level}] ${prefix} ${message}`
      : `[${level}] ${prefix} ${message}`;
  }

  return {
    error: (msg, ctx) => {
      if (!shouldLog(LogLevel.ERROR)) return;
      console.error(formatMessage(LogLevel.ERROR, msg), ctx ?? "");
    },
    warn: (msg, ctx) => {
      if (!shouldLog(LogLevel.WARN)) return;
      console.warn(formatMessage(LogLevel.WARN, msg), ctx ?? "");
    },
    info: (msg, ctx) => {
      if (!shouldLog(LogLevel.INFO)) return;
      console.info(formatMessage(LogLevel.INFO, msg), ctx ?? "");
    },
    debug: (msg, ctx) => {
      if (!shouldLog(LogLevel.DEBUG)) return;
      console.debug(formatMessage(LogLevel.DEBUG, msg), ctx ?? "");
    },
    errorWithException: (err, msg, ctx) => {
      const errorMessage =
        msg ?? (err instanceof Error ? err.message : String(err));
      const errorContext = {
        ...ctx,
        exceptionType: err instanceof Error ? err.constructor.name : "unknown",
      };
      console.error(formatMessage(LogLevel.ERROR, errorMessage), errorContext);
      if (err instanceof Error && err.stack) {
        console.error(err.stack);
      }
    },
  };
}

const internalLogger = createPrefixedLogger("[sync]");

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
