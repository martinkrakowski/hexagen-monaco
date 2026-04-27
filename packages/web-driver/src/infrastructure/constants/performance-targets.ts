/**
 * @module performance-targets
 * @description Performance SLAs and monitoring thresholds for critical adapters.
 *
 * These targets define acceptable performance bounds for async operations.
 * Operations exceeding target times are logged as warnings; operations
 * exceeding timeout values are aborted with structured errors.
 *
 * @convention Use PERFORMANCE_TARGETS when instrumenting adapters with timing.
 * @safety Timeouts are hard limits (enforced via AbortController or setTimeout).
 *         Targets are soft limits (logged as warnings only).
 */

/**
 * Performance SLAs for critical adapter operations.
 *
 * - `timeout`: Hard limit (ms) — operation aborts if exceeded
 * - `targetMs`: Soft limit (ms) — operation logged as warning if exceeded
 *
 * @example
 *   const { timeout, targetMs } = PERFORMANCE_TARGETS.LINTER;
 *   const start = performance.now();
 *   // ... operation ...
 *   const duration = performance.now() - start;
 *   if (duration > targetMs) {
 *     logger.warn(`Exceeded target: ${duration}ms > ${targetMs}ms`);
 *   }
 */
export const PERFORMANCE_TARGETS = {
  /**
   * Architecture linting: Validates manifest structure, bounded contexts, ports.
   * - Typical: 500ms–1.5s (depends on manifest complexity)
   * - Target: 2s (dev + CI friendly)
   * - Timeout: 30s (fail-fast on infrastructure issues)
   */
  LINTER: { timeout: 30000, targetMs: 2000 } as const,

  /**
   * Manifest reading: Parses YAML/JSON and deserializes to domain objects.
   * - Typical: 50–200ms
   * - Target: 500ms (instant perception)
   * - Timeout: 5s (file system bound)
   */
  MANIFEST_READER: { timeout: 5000, targetMs: 500 } as const,

  /**
   * Architecture generation: Full pipeline (prompt → LLM → manifest patch).
   * - Typical: 3–8s (LLM network bound)
   * - Target: 5s (good UX)
   * - Timeout: 60s (generous for slow networks)
   */
  GENERATION: { timeout: 60000, targetMs: 5000 } as const,

  /**
   * Cloud LLM response: Single API call to OpenAI/Anthropic/etc.
   * - Typical: 1–3s (API latency)
   * - Target: 3s (responsive streaming)
   * - Timeout: 30s (API SLA buffer)
   */
  LLM_RESPONSE: { timeout: 30000, targetMs: 3000 } as const,

  /**
   * Local LLM inference: WebLLM running in-browser on user hardware.
   * - Typical: 5–30s (GPU-dependent)
   * - Target: 10s (acceptable for local)
   * - Timeout: 120s (large models on weak GPU)
   */
  LOCAL_LLM_INFERENCE: { timeout: 120000, targetMs: 10000 } as const,

  /**
   * Graph layout solver: dagre/ELK auto-layout on large graphs.
   * - Typical: 100–500ms
   * - Target: 1s (interactive feel)
   * - Timeout: 10s (avoid UI freeze)
   */
  GRAPH_LAYOUT: { timeout: 10000, targetMs: 1000 } as const,

  /**
   * Semantic cache lookup: Fast in-memory queries.
   * - Typical: <1ms
   * - Target: 10ms (practical threshold)
   * - Timeout: 100ms (something is very wrong)
   */
  CACHE_LOOKUP: { timeout: 100, targetMs: 10 } as const,
} as const;

/**
 * Operation name type for safe access.
 */
export type PerformanceTargetKey = keyof typeof PERFORMANCE_TARGETS;

/**
 * Helper to retrieve targets by operation name.
 * @param operation The operation identifier
 * @returns Performance targets or null if not defined
 * @example
 *   const targets = getPerformanceTarget('LINTER');
 *   if (!targets) throw new Error('Unknown operation');
 */
export function getPerformanceTarget(
  operation: string,
): (typeof PERFORMANCE_TARGETS)[PerformanceTargetKey] | null {
  const key = operation.toUpperCase() as PerformanceTargetKey;
  return PERFORMANCE_TARGETS[key] ?? null;
}
