import type { BackpressureControllerPort } from "../../application/ports/out/backpressure-controller.port.js";

/**
 * In-memory Backpressure Controller — token bucket algorithm for
 * controlling the rate of intent processing.
 */
export class InMemoryBackpressureController implements BackpressureControllerPort {
  private maxConcurrency: number;
  private active: number;
  private queue: number;

  constructor(maxConcurrency: number = 10) {
    this.maxConcurrency = maxConcurrency;
    this.active = 0;
    this.queue = 0;
  }

  canAccept(): boolean {
    return this.active < this.maxConcurrency;
  }

  accept(): void {
    if (this.canAccept()) {
      this.active++;
    } else {
      this.queue++;
    }
  }

  complete(): void {
    if (this.active > 0) {
      this.active--;
    }
    // Process queued items if capacity is available
    while (this.queue > 0 && this.canAccept()) {
      this.queue--;
      this.active++;
    }
  }

  queueDepth(): number {
    return this.queue;
  }

  setMaxConcurrency(max: number): void {
    this.maxConcurrency = max;
  }
}
