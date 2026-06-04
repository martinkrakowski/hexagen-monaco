// @hexagen-server-only — privileged tool surface; never ship to a client bundle (ADR-0037).
/**
 * The tool-registration seam. Tools are declared statically (see
 * `register-all.ts`) by calling `registerTool(...)`; the composition root then
 * `applyTools()` them onto the dynamically-loaded `McpServer`. Decoupling the
 * declaration from the server instance keeps `register-all.ts` a flat, loop-free
 * list (the template engine can't codegen a loop) and lets you add a tool with
 * one import + one `registerTool(...)` line.
 */
import type { McpServerLike } from "../sdk.js";

/** An MCP tool result: text content, with `isError` set on a failure. */
export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface RegisteredTool {
  name: string;
  description: string;
  /** A zod raw shape (`{ field: z.string(), ... }`) describing the tool input. */
  inputSchema: Record<string, unknown>;
  handler: (input: Record<string, unknown>) => Promise<ToolResult>;
}

const tools: RegisteredTool[] = [];

export function registerTool(tool: RegisteredTool): void {
  tools.push(tool);
}

export function getRegisteredTools(): readonly RegisteredTool[] {
  return tools;
}

/** Wire every registered tool onto the MCP server. Called by the composition root. */
export function applyTools(server: McpServerLike): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      (input) => tool.handler(input),
    );
  }
}
