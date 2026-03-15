import { type LoggerPort } from "@hexagen/shared";

export const defaultLogger: LoggerPort = {
  info: (msg) => console.log(`[project-gen] ${msg}`),
  warn: (msg) => console.warn(`[project-gen] ${msg}`),
  error: (msg) => console.error(`[project-gen] ${msg}`),
  debug: (msg) => {
    if (process.env.DEBUG) console.log(`[debug] ${msg}`);
  },
  errorWithException: (err, msg) => {
    const errorMessage =
      msg ?? (err instanceof Error ? err.message : String(err));
    console.error(`[project-gen] ${errorMessage}`);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
  },
};
