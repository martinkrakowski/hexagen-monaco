export function parseIntSafe(
  raw: string | undefined,
  fallback: number,
  min = 0,
): number {
  const n = parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
}
