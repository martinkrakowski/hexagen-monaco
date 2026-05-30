/**
 * Parse a numeric environment variable with bounds-checking. Returns the
 * default and logs a warning if the input is missing, non-numeric, or
 * outside [min, max]. Naive `Number()` parsing yields NaN for "abc"
 * (e.g. REDIS_MAX_RETRIES=abc), and NaN comparisons silently corrupt
 * retry budgets — `times >= NaN` is always false, so the connection
 * client would retry forever. Validating up-front lets the workload
 * keep running on safe defaults instead of paging out at 03:00 over
 * an env typo.
 */
export function parseIntEnv(
  name: string,
  fallback: number,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    // eslint-disable-next-line no-console
    console.warn(
      `[bullmq] env ${name}=${JSON.stringify(raw)} is not a valid integer in [${min}, ${max}] — using default ${fallback}.`,
    );
    return fallback;
  }
  return parsed;
}
