export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string | Error): void;
  debug(message: string): void;
}

export function createConsoleLogger(quiet: boolean = false): Logger {
  return {
    info: (msg) => {
      if (!quiet) console.log(`[sync] ${msg}`);
    },
    warn: (msg) => {
      console.warn(`[sync] ${msg}`);
    },
    error: (msg) => {
      if (msg instanceof Error) {
        console.error(`[sync] ${msg.message}`);
        if (msg.stack) console.error(msg.stack);
      } else {
        console.error(`[sync] ${msg}`);
      }
    },
    debug: (msg) => {
      if (process.env.DEBUG) console.log(`[debug] ${msg}`);
    },
  };
}
