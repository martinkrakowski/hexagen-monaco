import type { BackpressureSignal } from "../../../domain/value-objects/backpressure-signal.js";

/**
 * BackpressureControllerPort — outbound port for managing load on the
 * intent processing pipeline.
 */
export interface BackpressureControllerPort {
  /** Check if the system can accept more work */
  canAccept(): boolean;

  /**
   * Signal that work has been accepted, returning a backpressure signal.
   * @param intentId - The ID of the intent being accepted
   * @returns A BackpressureSignal indicating how to handle the intent
   */
  accept(intentId: string): BackpressureSignal;

  /** Signal that work has been completed, freeing capacity */
  complete(intentId: string): void;

  /** Get current queue depth */
  queueDepth(): number;

  /** Set maximum concurrent transactions */
  setMaxConcurrency(max: number): void;
}
