import type { MCPServerAdapterDependencies } from "../mcp-server.types.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (
    args: unknown,
    deps: MCPServerAdapterDependencies,
  ) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
  }>;
}
