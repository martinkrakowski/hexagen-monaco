import type { RejectEmitterPort } from "../../src/application/ports/in/reject-emitter.port";
import type { Rejection } from "../../src/domain/rejection";

export class FakeRejectEmitter implements RejectEmitterPort {
  private readonly _emitted: Rejection[] = [];

  emit(rejection: Rejection): void {
    this._emitted.push(rejection);
  }

  get emitted(): ReadonlyArray<Rejection> {
    return this._emitted;
  }

  get emitCount(): number {
    return this._emitted.length;
  }

  get lastRejection(): Rejection | undefined {
    return this._emitted[this._emitted.length - 1];
  }
}
