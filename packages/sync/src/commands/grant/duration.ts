const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parses a `--expires-in` value like `4h`, `30m`, `900s`, `1d` into
 * milliseconds. Whole positive integers only — no fractional or compound
 * durations (`1h30m`), since a grant's expiry only needs to be "roughly
 * this long," not scheduled to the second.
 */
export function parseDurationMs(input: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(input.trim());
  if (!match) {
    throw new Error(
      `Invalid --expires-in '${input}': expected a positive integer followed by s, m, h, or d (e.g. 4h, 30m, 900s, 1d)`,
    );
  }
  const [, amount, unit] = match;
  const ms = Number(amount) * UNIT_MS[unit];
  if (ms <= 0) {
    throw new Error(`Invalid --expires-in '${input}': duration must be positive`);
  }
  return ms;
}
