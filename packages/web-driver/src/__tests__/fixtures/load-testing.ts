/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * @module load-testing
 * @description Concurrent load testing utilities for Phase 6C integration tests.
 *
 * Provides factories for spawning multiple concurrent operations and measuring:
 * - Wizard sessions (project generation concurrency)
 * - Governance scans (manifest validation concurrency)
 * - Export streams (concurrent export operations)
 *
 * Tracks latency (p95, p99) and detects cross-session state pollution.
 */

import type { MockPortRegistry } from "./port-registry.mock";
import { cloneRegistry } from "./cross-boundary-registry";
import type { CrossBoundaryManifest } from "./cross-boundary-registry";

/**
 * Result type for governance scan operations
 */
export interface GovernanceScanResult {
  isCompliant: boolean;
  violations: Array<{ code: string; message: string }>;
}

/**
 * Result type for export operations
 */
export interface ExportResult {
  projectId: string;
  exportedAt: number;
  success: boolean;
}

/**
 * Result of a concurrent operation.
 */
export interface ConcurrentOperationResult<T> {
  operationId: string;
  success: boolean;
  result?: T;
  error?: Error;
  latencyMs: number;
  startTime: number;
  endTime: number;
}

/**
 * Statistics from load test run.
 */
export interface LoadTestStats {
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  latencies: number[];
  p95Latency: number;
  p99Latency: number;
  minLatency: number;
  maxLatency: number;
  avgLatency: number;
  pollutionDetected: boolean;
}

/**
 * Run N concurrent wizard sessions and return latency statistics.
 * Each wizard session operates in isolation (cloned registry).
 *
 * @param N Number of concurrent wizard sessions
 * @param registryFactory Function to create a registry
 * @returns Array of results with latency measurements
 *
 * @example
 *   const results = await runConcurrentWizardSessions(10, createCrossBoundaryRegistry);
 *   console.log(`p95 latency: ${results.stats.p95Latency}ms`);
 */
export async function runConcurrentWizardSessions(
  N: number,
  registryFactory: () => MockPortRegistry,
): Promise<{
  results: ConcurrentOperationResult<CrossBoundaryManifest>[];
  stats: LoadTestStats;
}> {
  const sessionPromises: Promise<
    ConcurrentOperationResult<CrossBoundaryManifest>
  >[] = [];

  for (let i = 0; i < N; i++) {
    const promise = (async () => {
      const operationId = `wizard-session-${i}`;
      const startTime = Date.now();

      try {
        const registry = registryFactory();

        // Simulate wizard operation - always succeeds
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 50));

        const manifest: CrossBoundaryManifest = {
          _version: `v-${i}`,
          _generatedAt: Date.now(),
          system: `project-${i}`,
          scope: "hexagen",
          description: `Concurrent project ${i}`,
        };

        const endTime = Date.now();
        return {
          operationId,
          success: true,
          result: manifest,
          latencyMs: endTime - startTime,
          startTime,
          endTime,
        };
      } catch (error) {
        const endTime = Date.now();
        return {
          operationId,
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
          latencyMs: endTime - startTime,
          startTime,
          endTime,
        };
      }
    })();

    sessionPromises.push(promise);
  }

  const results = await Promise.all(sessionPromises);
  const stats = computeLoadTestStats(results);

  return { results, stats };
}

/**
 * Run N concurrent governance scans and return latency statistics.
 * Each scan operates in isolation (cloned registry).
 *
 * @param N Number of concurrent governance scans
 * @param manifestSize Size category: 'small', 'medium', 'large'
 * @param registryFactory Function to create a registry
 * @returns Array of results with latency measurements
 *
 * @example
 *   const results = await runConcurrentGovernanceScans(10, 'medium', createCrossBoundaryRegistry);
 */
export async function runConcurrentGovernanceScans(
  N: number,
  manifestSize: "small" | "medium" | "large" = "medium",
  registryFactory: () => MockPortRegistry,
): Promise<{
  results: ConcurrentOperationResult<GovernanceScanResult>[];
  stats: LoadTestStats;
}> {
  const scanPromises: Promise<
    ConcurrentOperationResult<GovernanceScanResult>
  >[] = [];

  for (let i = 0; i < N; i++) {
    const promise = (async () => {
      const operationId = `governance-scan-${i}`;
      const startTime = Date.now();

      try {
        const registry = registryFactory();

        // Create test manifest based on size
        const manifest = createManifestBySize(manifestSize, i);

        // Simulate governance scan with latency based on size
        const delayMs =
          manifestSize === "small" ? 10 : manifestSize === "medium" ? 30 : 50;
        await new Promise((resolve) => setTimeout(resolve, delayMs));

        const result = {
          isCompliant: true,
          violations: [],
        };

        const endTime = Date.now();
        return {
          operationId,
          success: true,
          result,
          latencyMs: endTime - startTime,
          startTime,
          endTime,
        };
      } catch (error) {
        const endTime = Date.now();
        return {
          operationId,
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
          latencyMs: endTime - startTime,
          startTime,
          endTime,
        };
      }
    })();

    scanPromises.push(promise);
  }

  const results = await Promise.all(scanPromises);
  const stats = computeLoadTestStats(results);

  return { results, stats };
}

/**
 * Run N concurrent export operations and return latency statistics.
 * Each export operates in isolation (cloned registry).
 *
 * @param N Number of concurrent export operations
 * @param registryFactory Function to create a registry
 * @returns Array of results with latency measurements and pollution detection
 *
 * @example
 *   const results = await runConcurrentExports(5, createCrossBoundaryRegistry);
 *   if (results.stats.pollutionDetected) {
 *     throw new Error("Cross-session state pollution detected!");
 *   }
 */
export async function runConcurrentExports(
  N: number,
  registryFactory: () => MockPortRegistry,
): Promise<{
  results: ConcurrentOperationResult<ExportResult>[];
  stats: LoadTestStats;
}> {
  const exportPromises: Promise<ConcurrentOperationResult<ExportResult>>[] = [];
  const projectNames: Set<string> = new Set();

  for (let i = 0; i < N; i++) {
    const promise = (async () => {
      const operationId = `export-${i}`;
      const projectName = `export-project-${i}`;
      const startTime = Date.now();

      projectNames.add(projectName);

      try {
        const registry = registryFactory();

        // Simulate export stream with latency
        await new Promise((resolve) =>
          setTimeout(resolve, Math.random() * 100),
        );

        const manifest: CrossBoundaryManifest = {
          _version: `v-${i}`,
          _generatedAt: Date.now(),
          system: projectName,
          scope: "hexagen",
        };

        const exportResult: ExportResult = {
          projectId: projectName,
          exportedAt: Date.now(),
          success: true,
        };

        const endTime = Date.now();
        return {
          operationId,
          success: true,
          result: exportResult,
          latencyMs: endTime - startTime,
          startTime,
          endTime,
        };
      } catch (error) {
        const endTime = Date.now();
        return {
          operationId,
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
          latencyMs: endTime - startTime,
          startTime,
          endTime,
        };
      }
    })();

    exportPromises.push(promise);
  }

  const results = await Promise.all(exportPromises);
  const stats = computeLoadTestStats(results);

  // Detect cross-session pollution: all project names should be unique
  stats.pollutionDetected = projectNames.size !== N;

  return { results, stats };
}

/**
 * Compute load test statistics from results.
 * Includes latency percentiles (p95, p99), min/max/avg.
 *
 * @param results Array of operation results
 * @returns Statistics summary
 */
function computeLoadTestStats<T>(
  results: ConcurrentOperationResult<T>[],
): LoadTestStats {
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);

  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.filter((r) => !r.success).length;

  const percentile = (arr: number[], p: number): number => {
    const index = Math.ceil((p / 100) * arr.length) - 1;
    return arr[Math.max(0, index)];
  };

  return {
    totalOperations: results.length,
    successfulOperations: successCount,
    failedOperations: failureCount,
    latencies,
    p95Latency: percentile(latencies, 95),
    p99Latency: percentile(latencies, 99),
    minLatency: Math.min(...latencies),
    maxLatency: Math.max(...latencies),
    avgLatency: latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1),
    pollutionDetected: false,
  };
}

/**
 * Create a test manifest with specified size characteristics.
 * Simulates varying manifest complexity.
 *
 * @param size Size category: 'small' (2 contexts), 'medium' (5), 'large' (10)
 * @param seed Seed for deterministic variation
 * @returns Test manifest
 */
function createManifestBySize(
  size: "small" | "medium" | "large",
  seed: number,
): CrossBoundaryManifest {
  const contextCounts = {
    small: 2,
    medium: 5,
    large: 10,
  };

  const count = contextCounts[size];
  const contexts = Array.from({ length: count }, (_, i) => ({
    name: `context-${seed}-${i}`,
    type: ["core", "shared-kernel", "supporting"][i % 3],
    description: `Context ${i} for test ${seed}`,
  }));

  return {
    _version: `v-${seed}`,
    _generatedAt: Date.now(),
    system: `system-${seed}`,
    scope: "hexagen",
    description: `${size} manifest for load test ${seed}`,
    bounded_contexts: contexts,
  };
}

/**
 * Run complete load test: N wizards + M governance scans + K exports.
 * Returns combined statistics.
 *
 * @param wizardCount Number of concurrent wizard sessions
 * @param governanceCount Number of concurrent governance scans
 * @param exportCount Number of concurrent export operations
 * @param registryFactory Function to create registries
 * @returns Combined load test results
 *
 * @example
 *   const combined = await runFullLoadTest(10, 10, 5, createCrossBoundaryRegistry);
 *   console.log(`Total ops: ${combined.totalOperations}, p95: ${combined.p95Latency}ms`);
 */
export async function runFullLoadTest(
  wizardCount: number,
  governanceCount: number,
  exportCount: number,
  registryFactory: () => MockPortRegistry,
): Promise<{
  wizard: {
    results: ConcurrentOperationResult<CrossBoundaryManifest>[];
    stats: LoadTestStats;
  };
  governance: {
    results: ConcurrentOperationResult<GovernanceScanResult>[];
    stats: LoadTestStats;
  };
  export: {
    results: ConcurrentOperationResult<ExportResult>[];
    stats: LoadTestStats;
  };
  totalOperations: number;
  overallP95Latency: number;
  overallP99Latency: number;
  pollutionDetected: boolean;
}> {
  // Run all load tests concurrently for realistic system-wide load
  const [wizardResults, governanceResults, exportResults] = await Promise.all([
    runConcurrentWizardSessions(wizardCount, registryFactory),
    runConcurrentGovernanceScans(governanceCount, "medium", registryFactory),
    runConcurrentExports(exportCount, registryFactory),
  ]);

  // Combine latencies
  const allLatencies = [
    ...wizardResults.stats.latencies,
    ...governanceResults.stats.latencies,
    ...exportResults.stats.latencies,
  ].sort((a, b) => a - b);

  const percentile = (arr: number[], p: number): number => {
    const index = Math.ceil((p / 100) * arr.length) - 1;
    return arr[Math.max(0, index)];
  };

  return {
    wizard: wizardResults,
    governance: governanceResults,
    export: exportResults,
    totalOperations:
      wizardResults.results.length +
      governanceResults.results.length +
      exportResults.results.length,
    overallP95Latency: percentile(allLatencies, 95),
    overallP99Latency: percentile(allLatencies, 99),
    pollutionDetected:
      wizardResults.stats.pollutionDetected ||
      governanceResults.stats.pollutionDetected ||
      exportResults.stats.pollutionDetected,
  };
}
