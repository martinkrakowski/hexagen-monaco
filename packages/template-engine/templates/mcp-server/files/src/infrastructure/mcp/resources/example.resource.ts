// @hexagen-server-only
/**
 * Example MCP resource (read-only) — exposes data a client can fetch by URI.
 * Resources mirror the tool pattern: validate, call a *read* use-case, return
 * its content. A worked stub: wire it onto the server from your composition root
 * and replace the body with a real read use-case.
 */
import type { McpServerLike } from "../sdk.js";

type ResourceCapableServer = McpServerLike & {
  registerResource?: (
    name: string,
    uri: string,
    handler: () => Promise<{ contents: Array<{ uri: string; text: string }> }>,
  ) => void;
};

export function registerExampleResource(server: McpServerLike): void {
  (server as ResourceCapableServer).registerResource?.(
    "example",
    "example://info",
    async () => ({
      contents: [
        { uri: "example://info", text: "Replace with a read use-case." },
      ],
    }),
  );
}
