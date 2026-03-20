import {
  LogLevel,
  type LogContext,
  type LoggerPort,
  type LoggerConfig,
} from "@hexagen/shared";

export class ConsoleLoggerAdapter implements LoggerPort {
  private readonly config: LoggerConfig;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      minLevel: config.minLevel ?? LogLevel.INFO,
      includeTimestamps: config.includeTimestamps ?? true,
    };
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [
      LogLevel.DEBUG,
      LogLevel.INFO,
      LogLevel.WARN,
      LogLevel.ERROR,
    ];
    const currentLevelIndex = levels.indexOf(this.config.minLevel);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex >= currentLevelIndex;
  }

  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = this.config.includeTimestamps
      ? new Date().toISOString()
      : "";
    return timestamp
      ? `${timestamp} [${level}] ${message}`
      : `[${level}] ${message}`;
  }

  error(message: string, context?: LogContext): void {
    if (!this.shouldLog(LogLevel.ERROR)) return;
    console.error(this.formatMessage(LogLevel.ERROR, message), context ?? "");
  }

  warn(message: string, context?: LogContext): void {
    if (!this.shouldLog(LogLevel.WARN)) return;
    console.warn(this.formatMessage(LogLevel.WARN, message), context ?? "");
  }

  info(message: string, context?: LogContext): void {
    if (!this.shouldLog(LogLevel.INFO)) return;
    console.info(this.formatMessage(LogLevel.INFO, message), context ?? "");
  }

  debug(message: string, context?: LogContext): void {
    if (!this.shouldLog(LogLevel.DEBUG)) return;
    console.debug(this.formatMessage(LogLevel.DEBUG, message), context ?? "");
  }

  errorWithException(
    err: Error | unknown,
    message?: string,
    context?: LogContext,
  ): void {
    const errorMessage =
      message ?? (err instanceof Error ? err.message : String(err));
    const errorContext = {
      ...context,
      exceptionType: err instanceof Error ? err.constructor.name : "unknown",
    };
    this.error(errorMessage, errorContext);

    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
  }
}

export function createConsoleLogger(
  config?: Partial<LoggerConfig>,
): LoggerPort {
  return new ConsoleLoggerAdapter(config);
}
