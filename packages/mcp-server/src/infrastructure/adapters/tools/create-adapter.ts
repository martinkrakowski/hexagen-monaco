import type { ToolDefinition } from "./tool-definition.js";

export const createAdapterTool: ToolDefinition = {
  name: "hexagen_create_adapter",
  description: "Create a new infrastructure adapter",
  inputSchema: {
    type: "object",
    properties: {
      port_name: { type: "string" },
      infrastructure_name: { type: "string" },
      dry_run: { type: "boolean" },
    },
    required: ["port_name", "infrastructure_name"],
  },
  handler: async (args, deps) => {
    const a = args as Record<string, unknown>;
    const result = await deps.createAdapterToolUseCase.execute({
      port_name: String(a.port_name ?? ""),
      infrastructure_name: String(a.infrastructure_name ?? ""),
      dry_run: (a.dry_run as boolean | undefined) ?? false,
    });
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result, null, 2) },
      ],
    };
  },
};
