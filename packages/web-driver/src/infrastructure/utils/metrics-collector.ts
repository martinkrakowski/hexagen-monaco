/**
 * @module metrics-collector
 * @description In-memory metrics collection for performance monitoring.
 *
 * Collects operation durations and computes statistical summaries
 * (min, max, avg, p95, p99) for debugging and optimization.
 *
 * **WARNING**: This is a simple in-memory collector. For production monitoring,
 * integrate with external systems (DataDog, New Relic, CloudWatch, etc.).
 *
 * @convention Use MetricsCollector.record() in adapters after operations complete.
 * @example
 *   const start = performance.now();
 *   await operation();
 *   const duration = performance.now() - start;
 *   MetricsCollector.record('linter', duration);
 */

/**
 * Statistical summary of sampled operation durations.
 */
export interface MetricStats {
  /** Number of samples collected */
  count: number;
  /** Minimum duration in milliseconds */
  min: number;
  /** Maximum duration in milliseconds */
  max: number;
  /** Arithmetic mean in milliseconds */
  avg: number;
  /** 95th percentile in milliseconds */
  p95: number;
  /** 99th percentile in milliseconds */
  p99: number;
}

/**
 * Simple in-memory metrics collector for adapter performance.
 *
 * Tracks operation durations and computes percentile summaries.
 * Thread-safe for use across concurrent operations.
 */
export class MetricsCollector {
  /**
   * Storage for operation samples: operation name → list of durations (ms)
   * @private
   */
  private static readonly metrics = new Map<string, number[]>();

  /**
   * Record a single operation duration.
   * @param operation The operation identifier (e.g., 'linter', 'llm_response')
   * @param durationMs The operation duration in milliseconds
   * @example
   *   MetricsCollector.record('linter', 1250);
   */
  static record(operation: string, durationMs: number): void {
    if (!this.metrics.has(operation)) {
      this.metrics.set(operation, []);
    }
    this.metrics.get(operation)!.push(durationMs);
  }

  /**
   * Compute statistical summary of all recorded samples for an operation.
   * @param operation The operation identifier
   * @returns Statistics object, or null if no samples recorded
   * @example
   *   const stats = MetricsCollector.getStats('linter');
   *   console.log(`p95: ${stats?.p95}ms`);
   */
  static getStats(operation: string): MetricStats | null {
    const samples = this.metrics.get(operation);
    if (!samples || samples.length === 0) {
      return null;
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const count = samples.length;
    const sum = samples.reduce((acc, val) => acc + val, 0);

    return {
      count,
      min: sorted[0]!,
      max: sorted[count - 1]!,
      avg: sum / count,
      p95: sorted[Math.floor(count * 0.95)]!,
      p99: sorted[Math.floor(count * 0.99)]!,
    };
  }

  /**
   * Get all recorded operations and their sample counts.
   * @returns Map of operation → sample count
   * @example
   *   const ops = MetricsCollector.getOperations();
   *   for (const [op, count] of ops.entries()) {
   *     console.log(`${op}: ${count} samples`);
   *   }
   */
  static getOperations(): Map<string, number> {
    const result = new Map<string, number>();
    for (const [op, samples] of this.metrics.entries()) {
      result.set(op, samples.length);
    }
    return result;
  }

  /**
   * Clear metrics for a specific operation or all operations.
   * @param operation The operation to clear, or undefined to clear all
   * @example
   *   MetricsCollector.reset('linter'); // Clear linter samples
   *   MetricsCollector.reset();        // Clear all metrics
   */
  static reset(operation?: string): void {
    if (operation) {
      this.metrics.delete(operation);
    } else {
      this.metrics.clear();
    }
  }

  /**
   * Export metrics as JSON for logging or external systems.
   * @returns Map of operation → MetricStats
   * @example
   *   const report = MetricsCollector.export();
   *   logger.info('Metrics', Object.fromEntries(report));
   */
  static export(): Map<string, MetricStats> {
    const result = new Map<string, MetricStats>();
    for (const [op] of this.metrics.entries()) {
      const stats = this.getStats(op);
      if (stats) {
        result.set(op, stats);
      }
    }
    return result;
  }
}
