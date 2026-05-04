import type { ToolDefinition } from "./tool-definition.js";

export const submitArchitecturalSpecTool: ToolDefinition = {
  name: "hexagen_submit_architectural_spec",
  description: "Submit an architectural specification for a feature",
  inputSchema: {
    type: "object",
    properties: {
      feature_id: { type: "string", description: "Feature identifier" },
      spec_content: {
        type: "string",
        description: "Architectural specification content (markdown)",
      },
    },
    required: ["feature_id", "spec_content"],
  },
  handler: async (args, deps) => {
    const a = args as Record<string, unknown>;
    const result = await deps.submitArchitecturalSpecToolUseCase.execute({
      featureId: a.feature_id as string,
      specContent: a.spec_content as string,
    });
    if (!result.success) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: result.error ?? "Unknown error",
          },
        ],
      };
    }
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result, null, 2) },
      ],
    };
  },
};
