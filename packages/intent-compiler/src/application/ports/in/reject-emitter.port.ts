import { Rejection } from "../../domain/rejection";

export interface RejectEmitterPort {
  emit(rejection: Rejection): void;
}