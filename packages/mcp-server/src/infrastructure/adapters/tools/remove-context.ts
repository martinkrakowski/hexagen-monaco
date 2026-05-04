import type { ToolDefinition } from "./tool-definition.js";

export const removeContextTool: ToolDefinition = {
  name: "hexagen_remove_context",
  description: "Remove a bounded context from the manifest",
  inputSchema: {
    type: "object",
    properties: {
      context_name: { type: "string" },
      dry_run: { type: "boolean" },
    },
    required: ["context_name"],
  },
  handler: async (args, deps) => {
    try {
      const a = args as Record<string, unknown>;
      const result = await deps.removeContextToolUseCase.execute({
        context_name: String(a.context_name ?? ""),
        dry_run: (a.dry_run as boolean | undefined) ?? false,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  },
};
