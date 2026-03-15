import { LogLevel, type LogContext, type LoggerConfig } from "@hexagen/shared";

export interface LoggerPort {
  error(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;
  errorWithException(
    err: Error | unknown,
    message?: string,
    context?: LogContext,
  ): void;
}

export type { LoggerConfig };
