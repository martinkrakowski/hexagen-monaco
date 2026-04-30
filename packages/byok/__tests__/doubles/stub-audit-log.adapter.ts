import type { Result } from "@hexagen/shared";
import type { ByokError } from "../../src/domain/errors/byok-error.vo.js";
import type {
  AuditLogPort,
  AuditEvent,
} from "../../src/application/ports/out/audit-log-port.port.js";

export class StubAuditLogAdapter implements AuditLogPort {
  private readonly events: AuditEvent[] = [];
  private shouldFail: boolean;

  constructor(options?: { shouldFail?: boolean }) {
    this.shouldFail = options?.shouldFail ?? false;
  }

  async record(event: AuditEvent): Promise<Result<void, ByokError>> {
    if (this.shouldFail) {
      return {
        success: false,
        error: { kind: "audit_log_error", message: "Stub audit log failure" },
      };
    }
    this.events.push(event);
    return { success: true, value: undefined };
  }

  getEvents(): AuditEvent[] {
    return [...this.events];
  }
}
