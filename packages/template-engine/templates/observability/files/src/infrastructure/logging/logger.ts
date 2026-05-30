import { getRequestContext } from "./context";
import { redact } from "./redact";

/**
 * Zero-dependency structured logger. Emits one line per call: JSON in
 * production, a readable line in development. Swap the internals for pino/winston
 * later without changing call sites — the interface (logger.info(fields, msg))
 * stays the same.
 */
type Level = "error" | "warn" | "info" | "debug";

const PRIORITY: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3 };

const ACTIVE_LEVEL = ((): Level => {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return raw in PRIORITY ? (raw as Level) : "info";
})();

// Set by the observability wizard via the `log_format` answer.
const LOG_FORMAT = "{log_format}";
const USE_PRETTY =
  LOG_FORMAT === "pretty-dev" ||
  (LOG_FORMAT === "auto" && process.env.NODE_ENV !== "production");

function enabled(level: Level): boolean {
  return PRIORITY[level] <= PRIORITY[ACTIVE_LEVEL];
}

function emit(level: Level, fields: Record<string, unknown>, message?: string): void {
  if (!enabled(level)) return;
  const ctx = getRequestContext();
  const base: Record<string, unknown> = {
    level,
    time: new Date().toISOString(),
    ...(ctx ? { requestId: ctx.requestId, userId: ctx.userId } : {}),
    ...(message ? { message } : {}),
    ...fields,
  };
  const record = redact(base);

  if (USE_PRETTY) {
    const reqId = ctx ? " [" + ctx.requestId + "]" : "";
    const tail = Object.keys(fields).length > 0 ? " " + JSON.stringify(redact(fields)) : "";
    console.log("[" + level.toUpperCase() + "]" + reqId + " " + (message ?? "") + tail);
  } else {
    console.log(JSON.stringify(record));
  }
}

export const logger = {
  error: (fields: Record<string, unknown> = {}, message?: string): void =>
    emit("error", fields, message),
  warn: (fields: Record<string, unknown> = {}, message?: string): void =>
    emit("warn", fields, message),
  info: (fields: Record<string, unknown> = {}, message?: string): void =>
    emit("info", fields, message),
  debug: (fields: Record<string, unknown> = {}, message?: string): void =>
    emit("debug", fields, message),
};
