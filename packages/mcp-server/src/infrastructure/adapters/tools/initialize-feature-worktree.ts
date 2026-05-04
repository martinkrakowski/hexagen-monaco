import type { ToolDefinition } from "./tool-definition.js";

export const initializeFeatureWorktreeTool: ToolDefinition = {
  name: "hexagen_initialize_feature_worktree",
  description: "Initialize a feature worktree with report governance tracking",
  inputSchema: {
    type: "object",
    properties: {
      feature_id: {
        type: "string",
        description: "Feature identifier (kebab-case)",
      },
    },
    required: ["feature_id"],
  },
  handler: async (args, deps) => {
    const a = args as Record<string, unknown>;
    const result = await deps.initializeFeatureWorktreeToolUseCase.execute({
      featureId: a.feature_id as string,
    });
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result, null, 2) },
      ],
    };
  },
};
