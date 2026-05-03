export type LogMeta = Record<string, unknown>;

const isTest = process.env.NODE_ENV === "test";
const isProduction = process.env.NODE_ENV === "production";

const formatMessage = (
  level: string,
  message: string,
  meta?: LogMeta,
): string => {
  const timestamp = isProduction ? new Date().toISOString() : "";
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
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
