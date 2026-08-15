import { NextRequest } from "next/server";

const requestCounts = new Map<string, { count: number; resetTime: number }>();

function cleanExpiredEntries() {
  const now = Date.now();
  for (const [key, record] of requestCounts.entries()) {
    if (record.resetTime <= now) {
      requestCounts.delete(key);
    }
  }
}

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
if (typeof setInterval !== "undefined") {
  const cleanupInterval = setInterval(cleanExpiredEntries, CLEANUP_INTERVAL_MS);
  if (typeof cleanupInterval.unref === "function") {
    cleanupInterval.unref();
  }
}

function hashKey(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

export function checkRateLimit(
  request: NextRequest,
  maxRequests = 10,
  windowMs = 60 * 1000, // 1 minute
  identifier?: string,
  keyPrefix?: string,
): { allowed: boolean; retryAfter?: number } {
  // A caller that already knows a stable per-principal key (e.g. an
  // authenticated user id) passes it as `identifier`; it takes precedence over
  // IP derivation so a signed-in user gets one budget regardless of which
  // forwarded IP their request arrives on. Callers that omit it fall back to
  // the IP-based key below.
  let key = identifier || undefined;

  if (!key) {
    let ip = (request as { cf?: { clientIp?: string } }).cf?.clientIp;
    if (!ip) {
      const forwardedFor = request.headers.get("x-forwarded-for");
      ip = forwardedFor?.split(",")[0]?.trim() ?? undefined;
    }
    if (!ip) {
      ip = request.headers.get("x-real-ip") ?? undefined;
    }
    key = ip;
  }

  if (!key) {
    const userAgent = request.headers.get("user-agent") ?? "";
    const acceptLanguage = request.headers.get("accept-language") ?? "";
    key = hashKey(userAgent + acceptLanguage);
  }

  // `keyPrefix` gives each logical limiter its own namespace in the shared
  // `requestCounts` map. Without it, two routes that derive the same key (e.g.
  // an anonymous caller's IP, or one signed-in `sub` used by several features)
  // would draw from a single bucket — and since a record stores only its count,
  // not the limit it was created under, a caller with a smaller `maxRequests`
  // could be wrongly blocked by another caller's traffic. Prefixing keeps the
  // per-route budgets independent.
  if (keyPrefix) {
    key = `${keyPrefix}:${key}`;
  }

  const now = Date.now();

  const record = requestCounts.get(key);

  if (record) {
    if (now > record.resetTime) {
      requestCounts.delete(key);
    } else {
      if (record.count >= maxRequests) {
        return { allowed: false, retryAfter: record.resetTime - now };
      }
      record.count++;
      return { allowed: true };
    }
  }

  requestCounts.set(key, { count: 1, resetTime: now + windowMs });
  return { allowed: true };
}
