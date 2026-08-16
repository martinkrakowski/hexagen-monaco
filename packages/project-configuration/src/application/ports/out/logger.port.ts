/**
 * Driven (outbound) port re-export — ADR-0048.
 *
 * `LoggerPort` is canonically defined in `@hexagen/shared` (ADR-0057 §2 keeps
 * ownership at the definition site). This package's own
 * `ConsoleLoggerAdapter` — an infrastructure adapter — implements it, which is
 * ADR-0048's operational test for a driven port, so the local re-export lives
 * under `application/ports/out`.
 */
export type { LoggerPort } from "@hexagen/shared";
export type { LoggerConfig } from "@hexagen/shared";
