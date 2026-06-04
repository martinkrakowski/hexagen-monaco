// @hexagen-server-only
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

/**
 * Bearer-token authentication for the HTTP transport. Compares the
 * `Authorization: Bearer <token>` header against `MCP_BEARER_TOKEN` with a
 * constant-time comparison. Fail-closed: denies when the env token is unset, so
 * a misconfigured deployment rejects every request rather than allowing them.
 */
export async function authenticate(req: IncomingMessage): Promise<boolean> {
  const expected = process.env.MCP_BEARER_TOKEN;
  if (!expected) return false; // fail closed — no token configured = deny all

  const header = req.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || !value.startsWith("Bearer ")) return false;

  const provided = value.slice("Bearer ".length).trim();
  return constantTimeEqual(provided, expected);
}

/**
 * Startup configuration check (called once from the HTTP transport factory): the
 * bearer transport is unusable without a token — an unset token fail-closes and
 * silently denies every request. Throw at startup so a missing secret is a loud,
 * immediate error rather than a confusing wall of 401s.
 */
export function assertConfigured(): void {
  if (!process.env.MCP_BEARER_TOKEN) {
    throw new Error(
      "Refusing to start: MCP_AUTH_MODE=bearer requires MCP_BEARER_TOKEN to be set " +
        "(an unset token denies every request).",
    );
  }
}

/**
 * Length-checked constant-time string compare. `timingSafeEqual` throws on a
 * length mismatch, so the length guard runs first (token length is not
 * meaningfully secret); equal-length tokens are then compared without an
 * early-exit timing side channel.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  return aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf);
}
