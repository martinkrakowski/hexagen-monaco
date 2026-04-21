import { RejectEmitterPort } from "../../../application/ports/in/reject-emitter.port";
import { Rejection } from "../../../domain/rejection";

export class DefaultRejectEmitterAdapter implements RejectEmitterPort {
  emit(rejection: Rejection): void {
    // TODO: Implement rejection emission logic (e.g., logging, UI notification)
    // For now, we just log to console (in a real app, we might use a logger port)
    console.warn(`Rejection emitted: ${rejection.reason}`);
  }
}