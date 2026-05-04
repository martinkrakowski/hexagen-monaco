import type { ToolDefinition } from "./tool-definition.js";

export const acceptTransactionTool: ToolDefinition = {
  name: "hexagen_accept_transaction",
  description: "Accept a transaction and mark it as committed",
  inputSchema: {
    type: "object",
    properties: {
      transaction_id: {
        type: "string",
        description: "Transaction ID to accept",
      },
    },
    required: ["transaction_id"],
  },
  handler: async (args, deps) => {
    const a = args as Record<string, unknown>;
    const result = await deps.acceptTransactionToolUseCase.execute({
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
