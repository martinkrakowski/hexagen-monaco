// @hexagen-server-only
/**
 * Defense-in-depth startup guard: refuse to start a network-exposed transport
 * without authentication. The structural protection is the template split — the
 * `mcp-server-http` addon's `auth` question has no `none` option — but `.env` is
 * hand-edited after generation, so this guard fails fast at startup if someone
 * sets `MCP_TRANSPORT=streamable-http` with auth disabled.
 *
 * Called first inside `createHttpTransport()`, i.e. only on the HTTP path: stdio
 * deployments pay nothing, and importing the transport module in a unit test
 * never trips it.
 */
export function assertSafeTransport(env: NodeJS.ProcessEnv): void {
  if (
    env.MCP_TRANSPORT === "streamable-http" &&
    (env.MCP_AUTH_MODE ?? "none") === "none"
  ) {
    throw new Error(
      "Refusing to start: MCP_TRANSPORT=streamable-http requires MCP_AUTH_MODE=bearer|oauth. " +
        "Set MCP_AUTH_MODE and the matching secret, or use the stdio transport.",
    );
  }
}
