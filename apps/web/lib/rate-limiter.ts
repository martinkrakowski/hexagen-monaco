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

export function checkRateLimit(
  request: NextRequest,
  maxRequests = 10,
  windowMs = 60 * 1000, // 1 minute
): { allowed: boolean; retryAfter?: number } {
  let ip = request.cf?.clientIp;
  if (!ip) {
    const forwardedFor = request.headers.get("x-forwarded-for");
    ip = forwardedFor?.split(",")[0]?.trim();
  }
  if (!ip) {
    ip = request.headers.get("x-real-ip");
  }
  if (!ip) {
    ip = request.headers.get("x-request-id");
  }
  if (!ip) {
    ip =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  const now = Date.now();

  const record = requestCounts.get(ip);

  if (record) {
    if (now > record.resetTime) {
      requestCounts.delete(ip);
    } else {
      if (record.count >= maxRequests) {
        return { allowed: false, retryAfter: record.resetTime - now };
      }
      record.count++;
      return { allowed: true };
    }
  }

  requestCounts.set(ip, { count: 1, resetTime: now + windowMs });
  return { allowed: true };
}
