import type { Result, ByokError } from "../../domain/index.js";
import { ok } from "../../domain/index.js";
import type {
  AuditLogPort,
  AuditEvent,
} from "../../application/ports/out/audit-log-port.port.js";

const FORBIDDEN_FIELDS = new Set([
  "rawKey",
  "apiKey",
  "ciphertext",
  "ENCRYPTION_KEY",
  "SERVER_ENCRYPTION_SECRET",
  "AuthTag",
  "IV",
]);

function scrubDetails(
  details: Record<string, unknown>,
): Record<string, unknown> {
  const scrubbed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    scrubbed[key] = FORBIDDEN_FIELDS.has(key) ? "[REDACTED]" : value;
  }
  return scrubbed;
}

export class ConsoleAuditLogAdapter implements AuditLogPort {
  async record(event: AuditEvent): Promise<Result<void, ByokError>> {
    try {
      const logEntry = {
        ...event,
        timestamp: new Date().toISOString(),
        details: scrubDetails(event.details),
      };
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(logEntry));
      return ok(undefined) as Result<void, ByokError>;
    } catch {
      return ok(undefined) as Result<void, ByokError>;
    }
  }
}
