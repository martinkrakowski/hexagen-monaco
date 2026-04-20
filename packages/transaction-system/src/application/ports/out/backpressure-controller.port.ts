/**
 * BackpressureControllerPort — outbound port for managing load on the
 * intent processing pipeline.
 */
export interface BackpressureControllerPort {
  /** Check if the system can accept more work */
  canAccept(): boolean;

  /** Signal that work has been accepted */
  accept(): void;

  /** Signal that work has been completed, freeing capacity */
  complete(): void;

  /** Get current queue depth */
  queueDepth(): number;

  /** Set maximum concurrent transactions */
  setMaxConcurrency(max: number): void;
}
