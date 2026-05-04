import type { ToolDefinition } from "./tool-definition.js";

export const generateTopologyTool: ToolDefinition = {
  name: "hexagen_generate_topology",
  description:
    "Generate bounded context topology from a project description using LLM",
  inputSchema: {
    type: "object",
    properties: {
      description: {
        type: "string",
        description: "Natural language project description",
      },
      max_retries: {
        type: "number",
        description: "Maximum retry attempts (default: 2)",
      },
    },
    required: ["description"],
  },
  handler: async (args, deps) => {
    const a = args as Record<string, unknown>;
    const result = await deps.generateTopologyToolUseCase.execute({
      description: a.description as string,
      maxRetries: a.max_retries as number | undefined,
    });
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result, null, 2) },
      ],
    };
  },
};
