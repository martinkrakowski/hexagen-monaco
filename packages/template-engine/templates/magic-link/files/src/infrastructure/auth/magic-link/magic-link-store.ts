// In-memory single-use token store.
// Bounds the map to MAX_SIZE entries with a simple eviction (oldest keys removed first).
// Swap this module for a Redis/Upstash adapter in production multi-replica deployments.

const MAX_SIZE = 10_000;
const used = new Map<string, number>(); // token signature → consumed timestamp

function evictIfNeeded(): void {
  if (used.size < MAX_SIZE) return;
  const toEvict = Math.floor(MAX_SIZE / 5);
  let count = 0;
  for (const key of used.keys()) {
    used.delete(key);
    if (++count >= toEvict) break;
  }
}

/**
 * Returns true and marks the token as consumed if it has not been used before.
 * Returns false if the token was already consumed (replay attack).
 */
export function consumeToken(tokenSignature: string): boolean {
  if (used.has(tokenSignature)) return false;
  evictIfNeeded();
  used.set(tokenSignature, Date.now());
  return true;
}

export function isTokenConsumed(tokenSignature: string): boolean {
  return used.has(tokenSignature);
}
