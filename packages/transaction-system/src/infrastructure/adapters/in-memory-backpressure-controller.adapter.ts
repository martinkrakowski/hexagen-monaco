import type { BackpressureControllerPort } from "../../application/ports/out/backpressure-controller.port.js";
import type { BackpressureSignal } from "../../domain/value-objects/backpressure-signal.js";

/**
 * In-memory Backpressure Controller — token bucket algorithm for
 * controlling the rate of intent processing.
 *
 * Tracks active processes and queued intents. When completing work,
 * processes queued items if capacity becomes available.
 */
export class InMemoryBackpressureController implements BackpressureControllerPort {
  private maxConcurrency: number;
  private active: number;
  private queue: number; // Simple count of queued items
  private readonly recentIntents: Map<string, number>; // intentId -> timestamp for coalescing
  private readonly intentWindow: number; // milliseconds to consider for coalescing

  constructor(maxConcurrency: number = 10, intentWindow: number = 5000) {
    this.maxConcurrency = maxConcurrency;
    this.active = 0;
    this.queue = 0;
    this.recentIntents = new Map();
    this.intentWindow = intentWindow;
  }

  canAccept(): boolean {
    return this.active < this.maxConcurrency;
  }

  /**
   * Accept work with intent coalescing.
   * Returns a BackpressureSignal indicating how to handle the intent.
   */
  accept(intentId: string): BackpressureSignal {
    // Clean old entries
    this.cleanQueue();

    // Check for intent coalescing - if same intent exists in window, coalesce
    const coalesceIntent = this.findCoalesceIntent(intentId);
    if (coalesceIntent) {
      return this.coalesceIntent(coalesceIntent);
    }

    // If we have capacity, accept the intent (move from queue to active)
    if (this.canAccept()) {
      this.active++;
      this.recentIntents.set(intentId, Date.now());
      return this.none();
    }

    // If at capacity, increment queue (work is waiting)
    this.queue++;
    this.recentIntents.set(intentId, Date.now());
    return this.dropIntent("Intent queued due to backpressure");
  }

  /**
   * Complete work on an intent.
   * @param intentId - The ID of the intent being completed
   */
  complete(intentId: string): void {
    // Only process if we believe this intent was active
    if (this.active > 0) {
      this.active--;
    }

    // Remove from recent intents tracking
    this.recentIntents.delete(intentId);

    // Process queued items if capacity is available
    while (this.queue > 0 && this.canAccept()) {
      this.queue--;
      this.active++;
      // In a real system, we'd process the next queued intent here
    }
  }

  /** Get current queue depth */
  queueDepth(): number {
    return this.queue;
  }

  /** Set maximum concurrent transactions */
  setMaxConcurrency(max: number): void {
    this.maxConcurrency = max;
  }

  /**
   * Clean old entries from recent intents outside the intent window
   */
  private cleanQueue(): void {
    const now = Date.now();
    const toRemove: string[] = [];
    for (const [intentId, timestamp] of this.recentIntents.entries()) {
      if (now - timestamp >= this.intentWindow) {
        toRemove.push(intentId);
      }
    }
    for (const intentId of toRemove) {
      this.recentIntents.delete(intentId);
    }
  }

  /**
   * Find if there's an identical intent in the window for coalescing
   * Returns the intentId if found, null otherwise
   */
  private findCoalesceIntent(intentId: string): string | null {
    // Clean old entries first
    this.cleanQueue();

    // Check if this intentId is in our recent intents map
    if (this.recentIntents.has(intentId)) {
      return intentId;
    }
    return null;
  }

  /**
   * Create a coalesce signal
   */
  private coalesceIntent(existingIntentId: string): BackpressureSignal {
    // In a more complete implementation, we would gather all matching intents
    // For now, we just signal that coalescing is possible with this intent
    return {
      tag: "coalesce",
      intentIds: [existingIntentId],
    };
  }

  /**
   * Create a no backpressure signal
   */
  private none(): BackpressureSignal {
    return { tag: "none" };
  }

  /**
   * Create a drop signal (for when intent is queued due to backpressure)
   */
  private dropIntent(reason: string): BackpressureSignal {
    return {
      tag: "drop",
      reason,
    };
  }
}
