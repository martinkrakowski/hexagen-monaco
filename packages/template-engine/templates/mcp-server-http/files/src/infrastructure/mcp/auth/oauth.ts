// @hexagen-server-only
import type { IncomingMessage } from "node:http";

/**
 * OAuth resource-server authentication for the HTTP transport (SCAFFOLD).
 *
 * Validate the incoming bearer token as an access token issued by your OAuth
 * provider (`MCP_OAUTH_ISSUER_URL`): verify the JWT signature against the
 * issuer's JWKS, then check the audience and any required scopes. This is left
 * as a deliberate scaffold because the issuer, audience, and scope policy are
 * project-specific.
 *
 * Fail-closed: returns false until you wire real verification — an unconfigured
 * OAuth deployment denies every request rather than allowing them.
 *
 * Recommended verifier — `jose` (`npm i jose`):
 *
 *   import { createRemoteJWKSet, jwtVerify } from "jose";
 *   const JWKS = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
 *   const { payload } = await jwtVerify(token, JWKS, {
 *     issuer,
 *     audience: "<your-mcp-server-audience>",
 *   });
 *   return hasRequiredScopes(payload.scope);
 */
export async function authenticate(req: IncomingMessage): Promise<boolean> {
  const issuer = process.env.MCP_OAUTH_ISSUER_URL;
  if (!issuer) return false; // fail closed — issuer unset = deny all

  const header = req.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || !value.startsWith("Bearer ")) return false;

  // const token = value.slice("Bearer ".length).trim();
  // TODO: verify `token` against the issuer JWKS (see the jose snippet above)
  //       and return true only for a valid token carrying the required scopes.
  return false; // <- replace with real verification; fail-closed until then
}

/**
 * Startup configuration check (called once from the HTTP transport factory):
 * OAuth verification needs the issuer URL. Throw at startup so a missing issuer
 * is a loud error rather than a silent deny-all. (Even when configured, this
 * scaffold denies until you implement verification above.)
 */
export function assertConfigured(): void {
  if (!process.env.MCP_OAUTH_ISSUER_URL) {
    throw new Error(
      "Refusing to start: MCP_AUTH_MODE=oauth requires MCP_OAUTH_ISSUER_URL to be set.",
    );
  }
}
