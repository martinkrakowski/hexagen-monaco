import type { ToolDefinition } from "./tool-definition.js";

export const diffManifestTool: ToolDefinition = {
  name: "hexagen_diff_manifest",
  description:
    "Compare current manifest against git HEAD or a file and return structural diff",
  inputSchema: {
    type: "object",
    properties: {
      compare_source: {
        type: "string",
        enum: ["git_head", "file"],
        description: "Source to compare against (default: git_head)",
      },
      file_path: {
        type: "string",
        description:
          "Path to manifest file for comparison (required when compare_source is 'file')",
      },
    },
  },
  handler: async (args, deps) => {
    const a = args as Record<string, unknown>;
    const result = await deps.diffManifestToolUseCase.execute({
      compare_source: a.compare_source as "git_head" | "file" | undefined,
      file_path: a.file_path as string | undefined,
    });
    if (result.success) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result.value, null, 2),
          },
        ],
      };
    }
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text:
            result.error instanceof Error
              ? result.error.message
              : String(result.error),
        },
      ],
    };
  },
};
