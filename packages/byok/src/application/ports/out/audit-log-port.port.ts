import type { Result } from "@hexagen/shared";
import type { ByokError } from "../../../domain/errors/byok-error.vo.js";
import type { ByokProvider } from "../../../domain/value-objects/provider.vo.js";

export type AuditEventType =
  | "byok.key_stored"
  | "byok.key_revoked"
  | "byok.key_rotated"
  | "byok.proxy_called"
  | "byok.decrypt_failure"
  | "byok.ip_anomaly"
  | "byok.rate_limit_hit";

export interface AuditEvent {
  eventType: AuditEventType;
  userId: string;
  provider?: ByokProvider;
  keyId?: string;
  requestId?: string;
  timestamp: string;
  details: Record<string, unknown>;
}

export interface AuditLogPort {
  record(event: AuditEvent): Promise<Result<void, ByokError>>;
}
