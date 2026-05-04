import type { LoggerPort } from "../../src/config.js";

export interface LogCall {
  level: "error" | "warn" | "info" | "debug";
  message: string;
}

export type SpyLogger = LoggerPort & { calls: LogCall[] };

export function createSpyLogger(): SpyLogger {
  const calls: LogCall[] = [];
  return {
    calls,
    error: (msg) => {
      calls.push({ level: "error", message: msg });
    },
    warn: (msg) => {
      calls.push({ level: "warn", message: msg });
    },
    info: (msg) => {
      calls.push({ level: "info", message: msg });
    },
    debug: (msg) => {
      calls.push({ level: "debug", message: msg });
    },
    errorWithException: (_err, msg) => {
      calls.push({ level: "error", message: msg ?? "errorWithException" });
    },
  };
}

export interface CapturedLog {
  level: "error" | "warn" | "info" | "debug";
  message: string;
}

export function makeCapturingLogger(): {
  logger: LoggerPort;
  logs: CapturedLog[];
} {
  const logs: CapturedLog[] = [];
  const logger: LoggerPort = {
    error: (msg) => {
      logs.push({ level: "error", message: msg });
    },
    warn: (msg) => {
      logs.push({ level: "warn", message: msg });
    },
    info: (msg) => {
      logs.push({ level: "info", message: msg });
    },
    debug: (msg) => {
      logs.push({ level: "debug", message: msg });
    },
    errorWithException: (_err, msg) => {
      logs.push({ level: "error", message: msg ?? "" });
    },
  };
  return { logger, logs };
}

export const silentLogger: LoggerPort = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  errorWithException: () => {},
};

export function messagesAt(
  logger: { calls: LogCall[] },
  level: LogCall["level"],
): string[] {
  return logger.calls.filter((c) => c.level === level).map((c) => c.message);
}
