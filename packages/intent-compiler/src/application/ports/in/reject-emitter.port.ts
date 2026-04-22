import type { Rejection } from "../../../domain/rejection.js";

export interface RejectEmitterPort {
  emit(rejection: Rejection): void;
}
