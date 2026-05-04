import type { ToolDefinition } from "./tool-definition.js";

export const addDependencyTool: ToolDefinition = {
  name: "hexagen_add_dependency",
  description: "Safely add dependency relation in manifest",
  inputSchema: {
    type: "object",
    properties: {
      source_module: { type: "string" },
      target_module: { type: "string" },
      dry_run: { type: "boolean" },
    },
    required: ["source_module", "target_module"],
  },
  handler: async (args, deps) => {
    try {
      const a = args as Record<string, unknown>;
      const result = await deps.addDependencyToolUseCase.execute({
        sourceModule: String(a.source_module ?? ""),
        targetModule: String(a.target_module ?? ""),
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
