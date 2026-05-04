import type { ToolDefinition } from "./tool-definition.js";

export const getTransactionTool: ToolDefinition = {
  name: "hexagen_get_transaction",
  description: "Get transaction details by ID",
  inputSchema: {
    type: "object",
    properties: {
      transaction_id: { type: "string", description: "Transaction ID" },
    },
    required: ["transaction_id"],
  },
  handler: async (args, deps) => {
    const a = args as Record<string, unknown>;
    const result = await deps.getTransactionToolUseCase.execute({
      transaction_id: a.transaction_id as string,
    });
    if (!result.success) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text:
              result.error instanceof Error
                ? result.error.message
                : String(result.error ?? "Unknown error"),
          },
        ],
      };
    }
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result.value, null, 2) },
      ],
    };
  },
};
