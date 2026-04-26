import type { Rejection } from "../../domain/rejection.js";
import type { RejectEmitterPort } from "../../application/ports/in/reject-emitter.port.js";

/**
 * ConsoleRejectEmitterAdapter
 *
 * Emits rejection events to the console logger with structured formatting.
 *
 * Responsibilities:
 * - Format rejection messages with timestamp and context
 * - Emit to console.error for visibility
 * - Include rejection reason and stack trace if available
 *
 * Implementation notes:
 * - Uses console.error for rejected intents (error-level severity)
 * - Includes ISO timestamp for debugging
 * - Preserves error stack trace for diagnostics
 *
 * @implements {RejectEmitterPort}
 */
export class ConsoleRejectEmitterAdapter implements RejectEmitterPort {
  emit(rejection: Rejection): void {
    const timestamp = new Date().toISOString();
    const formattedMessage = this.formatRejection(rejection, timestamp);

    // eslint-disable-next-line no-console
    console.error(formattedMessage);

    // Also log the stack trace if available
    if (rejection.stack) {
      // eslint-disable-next-line no-console
      console.error("Stack trace:", rejection.stack);
    }
  }

  /**
   * Format a rejection into a human-readable message
   */
  private formatRejection(rejection: Rejection, timestamp: string): string {
    const lines: string[] = [
      `[${timestamp}] Intent Compiler Rejection`,
      `Reason: ${rejection.reason}`,
    ];

    return lines.join("\n");
  }
}
