export type LogMeta = Record<string, unknown>;

const isTest = process.env.NODE_ENV === "test";
const isProduction = process.env.NODE_ENV === "production";

/**
 * Convert an Error to a plain object for logging. `JSON.stringify` renders an
 * Error as `{}` because `name`/`message`/`stack` are non-enumerable, which is
 * how an error logged as `{ error: err }` silently became `{"error":{}}`. We
 * surface those, plus any enumerable own-properties that Error subclasses carry
 * (e.g. a domain error's `stage`/`statusCode`) so structured context isn't lost.
 */
const errorToPojo = (err: Error): Record<string, unknown> => {
  const out: Record<string, unknown> = {
    name: err.name,
    message: err.message,
    stack: err.stack,
  };
  // name/message/stack are non-enumerable, so Object.keys never duplicates them.
  const own = err as unknown as Record<string, unknown>;
  for (const key of Object.keys(err)) {
    out[key] = own[key];
  }
  return out;
};

/**
 * Serialize log metadata, unwrapping Error values (recursively, via the
 * replacer). Never throws — a circular or otherwise unserializable meta falls
 * back to its key list rather than breaking the logging call site.
 */
export const serializeMeta = (meta: LogMeta): string => {
  try {
    return JSON.stringify(meta, (_key, value) =>
      value instanceof Error ? errorToPojo(value) : value,
    );
  } catch {
    return JSON.stringify({ unserializable: Object.keys(meta) });
  }
};

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
