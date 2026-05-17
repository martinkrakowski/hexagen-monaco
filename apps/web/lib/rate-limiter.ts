import { NextRequest } from "next/server";

const requestCounts = new Map<string, { count: number; resetTime: number }>();

export function checkRateLimit(
  request: NextRequest,
  maxRequests = 10,
  windowMs = 60 * 1000 // 1 minute
): { allowed: boolean; retryAfter?: number } {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const now = Date.now();

  const record = requestCounts.get(ip);

  if (!record || now > record.resetTime) {
    requestCounts.set(ip, { count: 1, resetTime: now + windowMs });
    return { allowed: true };
  }

  if (record.count >= maxRequests) {
    return { allowed: false, retryAfter: record.resetTime - now };
  }

  record.count++;
  return { allowed: true };
}
