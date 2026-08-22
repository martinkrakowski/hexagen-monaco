import { NextResponse, type NextRequest } from "next/server";
import { resolveAnonSession } from "./anon-session";
import {
  getQuotaStore,
  type LlmQuotaKind,
  type QuotaResult,
  type QuotaStore,
} from "./quota-store";
import { logger } from "./structured-logger";

/**
 * Result of a daily-quota check.
 *
 * When `ok`, spread `headers` into the route's response (carries the
 * `Set-Cookie` for a freshly-minted session, or is empty). When not `ok`,
 * either return the ready JSON `response` (JSON routes) or format your own
 * error from `message` / `retryAfterSeconds` / `result` (the streaming routes,
 * whose error channel is ndjson) — remembering to spread `headers` there too.
 */
export type QuotaGate =
  | { ok: true; headers: Record<string, string> }
  | {
      ok: false;
      headers: Record<string, string>;
      /** Ready-to-return JSON 429 (already includes `headers` + `Retry-After`). */
      response: NextResponse;
      /** User-facing exhaustion message. */
      message: string;
      retryAfterSeconds: number;
      result: QuotaResult;
    };

/**
 * Count one free-tier request of `kind` against the caller's anonymous-session
 * daily quota. Call this ONLY on the unauthenticated free-tier path — signed-in
 * and BYOK users aren't on the free tier. The per-IP limiter remains the burst
 * backstop; this adds the durable per-session daily cap.
 *
 * Fails OPEN: if the quota store can't be opened or read (e.g. the volume isn't
 * mounted yet), the request is allowed rather than 500'd — blocking the whole
 * product on a quota-store outage is the worse failure, and the per-IP limiter
 * still guards against burst abuse. `store` is injectable for tests.
 */
export function enforceDailyQuota(
  request: NextRequest,
  // Narrowed from QuotaKind: "scan" must not reach this helper's copy.
  // See LlmQuotaKind in quota-store.ts. Type-only -- no metering behaviour
  // changes, so ADR-0063's freeze on metering edits is not reversed.
  kind: LlmQuotaKind,
  store?: QuotaStore,
): QuotaGate {
  const { sessionId, setCookie } = resolveAnonSession(request);
  const headers: Record<string, string> = setCookie
    ? { "Set-Cookie": setCookie }
    : {};

  let result: QuotaResult;
  try {
    result = (store ?? getQuotaStore()).consume(sessionId, kind);
  } catch (error) {
    logger.warn("[quota] store unavailable — allowing request (fail-open)", {
      error,
      kind,
    });
    return { ok: true, headers };
  }

  if (result.allowed) {
    return { ok: true, headers };
  }

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((result.resetAt - Date.now()) / 1000),
  );
  const noun = kind === "chat" ? "chat messages" : "generations";
  const message = `You've reached the free-tier daily limit of ${result.limit} ${noun}. It resets at midnight UTC — add your own API key (BYOK) or run a local model to keep going now.`;

  // `success: false` keeps this body assignable to the JSON generate routes'
  // response type; `kind` is the field a client uses to tell a quota-429 apart
  // from the per-IP rate-limit 429.
  const response = NextResponse.json(
    {
      success: false,
      error: message,
      kind,
      limit: result.limit,
      remaining: 0,
      resetAt: result.resetAt,
      retryAfterSeconds,
    },
    {
      status: 429,
      headers: { ...headers, "Retry-After": String(retryAfterSeconds) },
    },
  );
  return { ok: false, headers, response, message, retryAfterSeconds, result };
}
