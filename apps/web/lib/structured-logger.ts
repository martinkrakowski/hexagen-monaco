export type LogMeta = Record<string, unknown>;

const isTest = process.env.NODE_ENV === "test";
const isProduction = process.env.NODE_ENV === "production";

/**
 * Serialize log metadata, unwrapping Error values. `JSON.stringify` renders an
 * Error as `{}` (its `name`/`message`/`stack` are non-enumerable), which is how
 * an error logged as `{ error: err }` silently became `{"error":{}}`. This
 * replacer surfaces the actual fields instead.
 */
export const serializeMeta = (meta: LogMeta): string =>
  JSON.stringify(meta, (_key, value) =>
    value instanceof Error
      ? { name: value.name, message: value.message, stack: value.stack }
      : value,
  );

const formatMessage = (
  level: string,
  message: string,
  meta?: LogMeta,
): string => {
  const timestamp = isProduction ? new Date().toISOString() : "";
  const metaStr = meta ? ` ${serializeMeta(meta)}` : "";
  return timestamp
    ? `${timestamp} [${level}] ${message}${metaStr}`
    : `[${level}] ${message}${metaStr}`;
};

export const logger = {
  info: (message: string, meta?: LogMeta) => {
    if (isTest) return;
    console.info(formatMessage("INFO", message, meta));
  },
  warn: (message: string, meta?: LogMeta) => {
    if (isTest) return;
    console.warn(formatMessage("WARN", message, meta));
  },
  error: (message: string, meta?: LogMeta) => {
    if (isTest) return;
    console.error(formatMessage("ERROR", message, meta));
  },
  debug: (message: string, meta?: LogMeta) => {
    if (isTest || isProduction) return;
    console.debug(formatMessage("DEBUG", message, meta));
  },
};
