import type { RejectEmitterPort } from "../ports/in/reject-emitter.port";
import type { Rejection } from "../../domain/rejection";

export class EmitRejectionUseCase {
  constructor(private readonly rejectEmitter: RejectEmitterPort) {}

  execute(rejection: Rejection): void {
    this.rejectEmitter.emit(rejection);
  }
}
