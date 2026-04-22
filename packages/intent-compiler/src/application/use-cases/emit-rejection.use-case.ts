import type { RejectEmitterPort } from "../ports/in/reject-emitter.port.js";
import type { Rejection } from "../../domain/rejection.js";

export class EmitRejectionUseCase {
  constructor(private readonly rejectEmitter: RejectEmitterPort) {}

  execute(rejection: Rejection): void {
    this.rejectEmitter.emit(rejection);
  }
}
