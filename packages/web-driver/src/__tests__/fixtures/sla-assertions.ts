/**
 * @module sla-assertions
 * @description Performance SLA assertion utilities for Phase 6D.
 *
 * Provides utilities for measuring and asserting compliance with performance SLAs:
 * - Percentile latency calculations (p95, p99)
 * - Duration within SLA bounds
 * - Timeout cascade detection
 * - Memory leak detection
 * - Structured SLA reports
 */

/**
 * Structured SLA report for a single operation.
 */
export interface SLAReport {
  operation: string;
  targetMs: number;
  p95Ms: number;
  p99Ms: number;
  passed: boolean;
  description?: string;
}

/**
 * Compute the Nth percentile of a sorted array.
 * @param sortedArray Sorted array of numbers (ascending)
 * @param percentile Percentile to compute (0-100)
 * @returns Value at the percentile
 *
 * @example
 *   const latencies = [100, 200, 300, 400, 500].sort((a, b) => a - b);
 *   const p95 = percentile(latencies, 95); // ~500
 */
function percentile(sortedArray: number[], percentile: number): number {
  if (sortedArray.length === 0) return 0;
  if (sortedArray.length === 1) return sortedArray[0];

  const index = (percentile / 100) * (sortedArray.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index % 1;

  if (lower === upper) {
    return sortedArray[lower];
  }

  return sortedArray[lower] * (1 - weight) + sortedArray[upper] * weight;
}

/**
 * Assert that measurements comply with a target latency at a given percentile.
 * @param measurements Array of latency measurements (ms)
 * @param percentileTarget Percentile to assert (e.g., 95)
 * @param targetMs Target latency for the percentile (ms)
 * @throws Error if the percentile exceeds the target
 * @returns The actual latency at the percentile
 *
 * @example
 *   const measurements = [100, 200, 300, 400, 500];
 *   assertLatencyPercentile(measurements, 95, 450); // Passes: p95=480 < 500 (approx)
 */
export function assertLatencyPercentile(
  measurements: number[],
  percentileTarget: number,
  targetMs: number,
): number {
  if (measurements.length === 0) {
    throw new Error("assertLatencyPercentile: measurements array is empty");
  }

  const sorted = [...measurements].sort((a, b) => a - b);
  const actualLatency = percentile(sorted, percentileTarget);

  if (actualLatency > targetMs) {
    throw new Error(
      `SLA Violation: p${percentileTarget} = ${actualLatency.toFixed(0)}ms exceeds target ${targetMs}ms`,
    );
  }

  return actualLatency;
}

/**
 * Assert that actual duration is within SLA bounds.
 * @param actualMs Measured duration (ms)
 * @param targetMs Target/soft limit (ms)
 * @param percentile Percentile context (informational)
 * @throws Error if actual exceeds target
 *
 * @example
 *   assertDurationWithinSLA(4800, 5000, 95); // Passes
 */
export function assertDurationWithinSLA(
  actualMs: number,
  targetMs: number,
  percentile: number,
): void {
  if (actualMs > targetMs) {
    throw new Error(
      `SLA Violation [p${percentile}]: ${actualMs.toFixed(0)}ms exceeds target ${targetMs}ms`,
    );
  }
}

/**
 * Assert that results do not exhibit timeout cascades.
 * A timeout cascade is detected when multiple operations fail with ETIMEDOUT
 * in rapid succession, suggesting system-wide starvation.
 *
 * @param results Array of operation results with error information
 * @throws Error if timeout cascade detected
 *
 * @example
 *   const results = [
 *     { success: false, error: new Error('ETIMEDOUT') },
 *     { success: false, error: new Error('ETIMEDOUT') },
 *   ];
 *   assertNoTimeoutCascade(results); // Throws: cascade detected
 */
export function assertNoTimeoutCascade(
  results: Array<{ success: boolean; error?: Error | string }>,
): void {
  const timeoutErrors = results.filter(
    (r) =>
      !r.success &&
      (r.error instanceof Error
        ? r.error.message.includes("ETIMEDOUT") ||
          r.error.message.includes("timeout") ||
          r.error.message.includes("Timeout")
        : String(r.error).includes("timeout")),
  );

  // Threshold: more than 20% of operations timing out suggests cascade
  const cascadeThreshold = Math.max(2, Math.ceil(results.length * 0.2));
  if (timeoutErrors.length >= cascadeThreshold) {
    throw new Error(
      `Timeout cascade detected: ${timeoutErrors.length}/${results.length} operations timed out (>=${cascadeThreshold} threshold)`,
    );
  }
}

/**
 * Assert that memory usage is stable (no leak detected).
 * Compares memory snapshots before and after, checking for excessive growth.
 *
 * @param beforeBytes Memory usage before operation (bytes)
 * @param afterBytes Memory usage after operation (bytes)
 * @param thresholdBytes Maximum allowed growth (bytes)
 * @throws Error if growth exceeds threshold
 *
 * @example
 *   const before = process.memoryUsage().heapUsed;
 *   // ... operation ...
 *   const after = process.memoryUsage().heapUsed;
 *   assertMemoryStable(before, after, 50 * 1024 * 1024); // 50MB threshold
 */
export function assertMemoryStable(
  beforeBytes: number,
  afterBytes: number,
  thresholdBytes: number,
): void {
  const growth = afterBytes - beforeBytes;
  if (growth > thresholdBytes) {
    const growthMB = (growth / (1024 * 1024)).toFixed(2);
    const thresholdMB = (thresholdBytes / (1024 * 1024)).toFixed(2);
    throw new Error(
      `Memory leak detected: +${growthMB}MB exceeds threshold ${thresholdMB}MB`,
    );
  }
}

/**
 * Compute comprehensive statistics from a set of measurements.
 * @param measurements Array of latency measurements (ms)
 * @returns Statistics object with percentiles, min, max, avg
 */
export function computeLatencyStats(measurements: number[]): {
  p95: number;
  p99: number;
  min: number;
  max: number;
  avg: number;
  median: number;
  count: number;
} {
  if (measurements.length === 0) {
    return { p95: 0, p99: 0, min: 0, max: 0, avg: 0, median: 0, count: 0 };
  }

  const sorted = [...measurements].sort((a, b) => a - b);
  const sum = measurements.reduce((a, b) => a + b, 0);

  return {
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: sum / measurements.length,
    median: percentile(sorted, 50),
    count: measurements.length,
  };
}

/**
 * Generate a structured SLA report for an operation.
 * @param operation Operation name (e.g., "Wizard Generation")
 * @param measurements Array of latency measurements (ms)
 * @param targetMs Target SLA (ms)
 * @param description Optional description
 * @returns SLA report
 *
 * @example
 *   const report = generateSLAReport(
 *     "Wizard Generation",
 *     [100, 200, 300, 400, 500],
 *     5000,
 *   );
 *   console.table(report);
 */
export function generateSLAReport(
  operation: string,
  measurements: number[],
  targetMs: number,
  description?: string,
): SLAReport {
  const stats = computeLatencyStats(measurements);
  return {
    operation,
    targetMs,
    p95Ms: stats.p95,
    p99Ms: stats.p99,
    passed: stats.p95 <= targetMs,
    description,
  };
}

/**
 * Format latency in human-readable form.
 * @param ms Duration in milliseconds
 * @returns Formatted string (e.g., "1234ms", "1.2s")
 */
export function formatLatency(ms: number): string {
  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Merge multiple SLA reports into a summary table.
 * @param reports Array of SLA reports
 * @returns Markdown table string
 */
export function generateSLATable(reports: SLAReport[]): string {
  const header = "| Operation | Target (ms) | P95 (ms) | P99 (ms) | Status |";
  const separator = "|-----------|------------|----------|----------|--------|";
  const rows = reports.map((r) => {
    const status = r.passed ? "✅ PASS" : "❌ FAIL";
    return `| ${r.operation} | ${r.targetMs} | ${r.p95Ms.toFixed(0)} | ${r.p99Ms.toFixed(0)} | ${status} |`;
  });

  return [header, separator, ...rows].join("\n");
}

/**
 * Check if all reports pass their SLAs.
 * @param reports Array of SLA reports
 * @returns true if all pass, false otherwise
 */
export function allSLAsPassed(reports: SLAReport[]): boolean {
  return reports.every((r) => r.passed);
}

/**
 * Generate a pass rate summary.
 * @param reports Array of SLA reports
 * @returns Percentage of SLAs passing
 */
export function getSLAPassRate(reports: SLAReport[]): number {
  if (reports.length === 0) return 0;
  const passed = reports.filter((r) => r.passed).length;
  return (passed / reports.length) * 100;
}
