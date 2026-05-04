import type { ToolDefinition } from "./tool-definition.js";

export const generateAdaptersTool: ToolDefinition = {
  name: "hexagen_generate_adapters",
  description:
    "Generate infrastructure adapters for a bounded context's ports using LLM",
  inputSchema: {
    type: "object",
    properties: {
      context_name: {
        type: "string",
        description: "Name of the bounded context",
      },
      port_names: {
        type: "array",
        items: { type: "string" },
        description: "Valid port names to generate adapters for",
      },
      max_retries: {
        type: "number",
        description: "Maximum retry attempts (default: 2)",
      },
    },
    required: ["context_name", "port_names"],
  },
  handler: async (args, deps) => {
    try {
      const a = args as Record<string, unknown>;
      const result = await deps.generateAdaptersToolUseCase.execute({
        contextName: a.context_name as string,
        portNames: a.port_names as string[],
        maxRetries: a.max_retries as number | undefined,
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
