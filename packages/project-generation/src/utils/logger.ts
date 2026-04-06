import { LogLevel, type LoggerPort } from "@hexagen/shared";

export const defaultLogger: LoggerPort = (() => {
  const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
  const minLevel = LogLevel.INFO;
  const currentLevelIndex = levels.indexOf(minLevel);

  function shouldLog(level: LogLevel): boolean {
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex >= currentLevelIndex;
  }

  return {
    error: (msg, ctx) => {
      if (!shouldLog(LogLevel.ERROR)) return;
      console.error(`[project-gen] ${msg}`, ctx ?? "");
    },
    warn: (msg, ctx) => {
      if (!shouldLog(LogLevel.WARN)) return;
      console.warn(`[project-gen] ${msg}`, ctx ?? "");
    },
    info: (msg, ctx) => {
      if (!shouldLog(LogLevel.INFO)) return;
      console.log(`[project-gen] ${msg}`, ctx ?? "");
    },
    debug: (msg, ctx) => {
      if (!shouldLog(LogLevel.DEBUG)) return;
      if (process.env.DEBUG) console.log(`[debug] ${msg}`, ctx ?? "");
    },
    errorWithException: (err, msg, ctx) => {
      const errorMessage =
        msg ?? (err instanceof Error ? err.message : String(err));
      console.error(`[project-gen] ${errorMessage}`, ctx ?? "");
      if (err instanceof Error && err.stack) {
        console.error(err.stack);
      }
    },
  };
})();
