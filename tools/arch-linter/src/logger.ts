import type { LoggerPort } from "@hexagen/shared";

export type { LoggerPort };

export function createConsoleLogger(quiet: boolean = false): LoggerPort {
  return {
    info: (msg) => {
      if (!quiet) console.log(`[arch-lint] ${msg}`);
    },
    warn: (msg) => console.warn(`[arch-lint] ${msg}`),
    error: (msg) => console.error(`[arch-lint] ${msg}`),
    debug: (msg) => {
      if (process.env.DEBUG) console.log(`[debug] ${msg}`);
    },
    errorWithException: (err, msg) => {
      const errorMessage =
        msg ?? (err instanceof Error ? err.message : String(err));
      console.error(`[arch-lint] ${errorMessage}`);
      if (err instanceof Error && err.stack) {
        console.error(err.stack);
      }
    },
  };
}
