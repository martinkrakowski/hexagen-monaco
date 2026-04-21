import type { RejectEmitterPort } from "../../application/ports/in/reject-emitter.port";
import type { Rejection } from "../../domain/rejection";

/**
 * Default in-memory rejection emitter. Swallows emissions silently.
 * A production-grade adapter would inject a LoggerPort or telemetry port.
 */
export class DefaultRejectEmitterAdapter implements RejectEmitterPort {
  emit(_rejection: Rejection): void {
    // Intentionally no-op — rejection logging is a concern for a LoggerPort adapter.
    // See Phase 3.A.11 for the full implementation plan.
  }
}
