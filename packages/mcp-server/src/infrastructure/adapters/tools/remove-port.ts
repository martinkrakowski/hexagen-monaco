import type { ToolDefinition } from "./tool-definition.js";

export const removePortTool: ToolDefinition = {
  name: "hexagen_remove_port",
  description: "Remove a port from a bounded context",
  inputSchema: {
    type: "object",
    properties: {
      context_name: { type: "string" },
      port_name: { type: "string" },
      direction: { type: "string", enum: ["inbound", "outbound"] },
      dry_run: { type: "boolean" },
    },
    required: ["context_name", "port_name", "direction"],
  },
  handler: async (args, deps) => {
    const a = args as Record<string, unknown>;
    const result = await deps.removePortToolUseCase.execute({
      context_name: String(a.context_name ?? ""),
      port_name: String(a.port_name ?? ""),
      direction: String(a.direction ?? "inbound") as "inbound" | "outbound",
      dry_run: (a.dry_run as boolean | undefined) ?? false,
    });
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result, null, 2) },
      ],
    };
  },
};
