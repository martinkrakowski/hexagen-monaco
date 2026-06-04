// @hexagen-server-only — loads the MCP SDK; must never reach a client bundle (ADR-0037).
/**
 * Dynamic-import wrapper for `@modelcontextprotocol/sdk` (ADR-0010).
 *
 * The SDK ships `node:`-scheme imports that break webpack when imported
 * statically into a client-bundled app, so it is loaded at runtime via
 * `import()` instead. A side benefit: a missing SDK fails *here*, with a clear
 * install hint, rather than breaking the build.
 *
 * Install it: `npm install @modelcontextprotocol/sdk zod`
 */

// The SDK is loaded at runtime, so its types aren't statically available here;
// the composition root treats the returned values structurally.
export interface LoadedSdk {
  McpServer: new (info: { name: string; version: string }) => McpServerLike;
}

export interface McpServerLike {
  registerTool(
    name: string,
    config: { description: string; inputSchema: Record<string, unknown> },
    handler: (input: Record<string, unknown>) => Promise<unknown>,
  ): void;
  connect(transport: unknown): Promise<void>;
}

let cached: Promise<LoadedSdk> | null = null;

export function loadSdk(): Promise<LoadedSdk> {
  cached ??= import("@modelcontextprotocol/sdk/server/mcp.js")
    .then((mod) => ({ McpServer: mod.McpServer as LoadedSdk["McpServer"] }))
    .catch((cause: unknown) => {
      cached = null;
      throw new Error(
        "Failed to load @modelcontextprotocol/sdk. Install it: `npm install @modelcontextprotocol/sdk zod`.",
        { cause },
      );
    });
  return cached;
}
