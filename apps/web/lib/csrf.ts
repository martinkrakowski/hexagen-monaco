/**
 * D-H7 — CSRF double-submit primitives (2026-08-25).
 *
 * The 2026-08-20 hosting plan gated a per-request CSRF token behind D-H7:
 * "adopt double-submit when team tenancy raises the blast radius (H1 exit)".
 * H1 has now shipped — orgs, teams, and project shares are live — so the
 * plan's own trigger has fired and this module closes the gate.
 *
 * The pattern: a random token lives in a cookie that is deliberately NOT
 * httpOnly (the page's own script must be able to read it), and every
 * cookie-authenticated mutation echoes it in the `x-hexagen-csrf` header.
 * A cross-site attacker can make the browser SEND our cookies, but the
 * same-origin policy stops their page READING them — so they cannot supply a
 * matching header. No server-side state is involved.
 *
 * This module is imported by the Next.js middleware, which may run on the
 * edge runtime — so it must not touch node:crypto or any Node built-in.
 * The comparison below is the constant-time XOR-accumulator equivalent of
 * `crypto.timingSafeEqual`, and the test suite asserts that shape by
 * construction rather than by measuring wall-clock time.
 */

/** Deliberately NOT httpOnly — double-submit requires script-readable. */
export const CSRF_COOKIE_NAME = "hexagen-csrf";

export const CSRF_HEADER_NAME = "x-hexagen-csrf";

/** Distinct error code so a client can recover by refetching `/api/csrf`. */
export const CSRF_ERROR_CODE = "csrf";

/**
 * Constant-time string equality.
 *
 * A `===` on secrets short-circuits at the first differing character, which
 * leaks a timing signal an attacker can use to recover the token byte by
 * byte. This accumulates XOR differences across the FULL length of both
 * inputs and only inspects the accumulator at the end — the loop's duration
 * depends on the inputs' lengths, never on where they differ. A length
 * mismatch still walks the longer input before returning false.
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < max; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Does the header echo the cookie? Both must be present and non-empty —
 * an attacker can send NO header trivially, so absence is always a mismatch.
 */
export function csrfTokensMatch(
  cookieValue: string | undefined | null,
  headerValue: string | undefined | null,
): boolean {
  if (!cookieValue || !headerValue) return false;
  return timingSafeEqualStrings(cookieValue, headerValue);
}
