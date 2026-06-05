// @hexagen-server-only
/**
 * Defense-in-depth startup guard: refuse to start a network-exposed transport
 * without authentication. The structural protection is the template split — the
 * `mcp-server-http` addon's `auth` question has no `none` option — but `.env` is
 * hand-edited after generation, so this guard fails fast at startup unless
 * `MCP_TRANSPORT=streamable-http` is paired with a valid `MCP_AUTH_MODE`
 * (`bearer` | `oauth`). It enforces an **allowlist**, so an empty string,
 * `none`, or any other invalid value is rejected — not just an unset variable.
 *
 * Called first inside `createHttpTransport()`, i.e. only on the HTTP path: stdio
 * deployments pay nothing, and importing the transport module in a unit test
 * never trips it. `MCP_AUTH_MODE` is read only here — the auth implementation
 * itself is fixed at install.
 */
export function assertSafeTransport(env: NodeJS.ProcessEnv): void {
  if (env.MCP_TRANSPORT !== "streamable-http") return;

  const mode = (env.MCP_AUTH_MODE ?? "").trim().toLowerCase();
  if (mode !== "bearer" && mode !== "oauth") {
    throw new Error(
      "Refusing to start: MCP_TRANSPORT=streamable-http requires MCP_AUTH_MODE=bearer|oauth. " +
        "Set MCP_AUTH_MODE and the matching secret, or use the stdio transport.",
    );
  }
}
