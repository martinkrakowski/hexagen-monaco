import type { LogContext, LoggerPort } from "@hexagen/shared";

interface LogEntry {
  level: "error" | "warn" | "info" | "debug";
  message: string;
  context?: LogContext;
}

export class LoggerFake implements LoggerPort {
  private logs: LogEntry[] = [];

  error(message: string, context?: LogContext): void {
    this.logs.push({ level: "error", message, context });
  }

  warn(message: string, context?: LogContext): void {
    this.logs.push({ level: "warn", message, context });
  }

  info(message: string, context?: LogContext): void {
    this.logs.push({ level: "info", message, context });
  }

  debug(message: string, context?: LogContext): void {
    this.logs.push({ level: "debug", message, context });
  }

  errorWithException(
    err: Error | unknown,
    message?: string,
    context?: LogContext,
  ): void {
    const errorMessage =
      message ?? (err instanceof Error ? err.message : String(err));
    this.logs.push({
      level: "error",
      message: errorMessage,
      context: { ...context, exception: String(err) },
    });
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  getLogsByLevel(level: LogEntry["level"]): LogEntry[] {
    return this.logs.filter((l) => l.level === level);
  }

  getErrors(): LogEntry[] {
    return this.getLogsByLevel("error");
  }

  getWarnings(): LogEntry[] {
    return this.getLogsByLevel("warn");
  }

  hasErrors(): boolean {
    return this.logs.some((l) => l.level === "error");
  }

  hasMessageContaining(substring: string): boolean {
    return this.logs.some((l) => l.message.includes(substring));
  }

  reset(): void {
    this.logs = [];
  }

  clear(): void {
    this.logs = [];
  }
}
