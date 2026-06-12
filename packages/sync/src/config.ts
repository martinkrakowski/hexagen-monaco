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
  /**
   * Optional `--only` scope patterns. When non-empty, the engine writes only
   * files whose workspace-relative path matches one of these (see
   * {@link matchesScope}); all others are skipped. Conservative direct-targets
   * semantics — no dependency fan-out. Undefined/empty means "no filter".
   */
  only?: string[];
  /**
   * Optional migration-report destination, resolved against the workspace
   * root (absolute paths allowed; parent dirs are created on write). Real
   * runs default to SYNC-MIGRATION-REPORT.md when unset; under --dry-run the
   * report file is skipped entirely UNLESS this is set — `--report <path>` is
   * the explicit opt-in to write a preview report.
   */
  report?: string;
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

      // Lenient on a missing value (warn + skip) where the commander front
      // door hard-errors on `--report <path>` — deliberate divergence:
      // parseArgs serves programmatic/test callers that shouldn't die on a
      // malformed optional flag (review #315).
      case "--report": {
        const next = args[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          flags.report = args[++i];
        } else {
          flags.logger.warn("--report requires a path argument — ignored");
        }
        break;
      }

      case "--only": {
        // Collect following non-flag tokens as scope patterns (supports both
        // `--only a b` and repeated `--only a --only b`).
        const patterns: string[] = [];
        while (i + 1 < args.length && !args[i + 1].startsWith("-")) {
          patterns.push(args[++i]);
        }
        flags.only = [...(flags.only ?? []), ...patterns];
        break;
      }

      default:
        if (arg.startsWith("-")) {
          flags.logger.warn(`Unknown flag ignored: ${arg}`);
        }
        break;
    }
  }

  return flags;
}
