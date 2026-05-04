import type { ToolDefinition } from "./tool-definition.js";

export const createPortTool: ToolDefinition = {
  name: "hexagen_create_port",
  description: "Create a new port contract",
  inputSchema: {
    type: "object",
    properties: {
      domain_name: { type: "string" },
      port_name: { type: "string" },
      type: { type: "string", enum: ["inbound", "outbound"] },
      dry_run: { type: "boolean" },
    },
    required: ["domain_name", "port_name", "type"],
  },
  handler: async (args, deps) => {
    const a = args as Record<string, unknown>;
    const result = await deps.createPortToolUseCase.execute({
      domain_name: String(a.domain_name ?? ""),
      port_name: String(a.port_name ?? ""),
      type: String(a.type ?? "inbound") as "inbound" | "outbound",
      dry_run: (a.dry_run as boolean | undefined) ?? false,
    });
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result, null, 2) },
      ],
    };
  },
};
