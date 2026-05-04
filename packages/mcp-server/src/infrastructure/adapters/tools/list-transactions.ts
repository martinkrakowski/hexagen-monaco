import type { ToolDefinition } from "./tool-definition.js";

export const listTransactionsTool: ToolDefinition = {
  name: "hexagen_list_transactions",
  description: "List all transactions with optional status filter",
  inputSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["pending", "speculative", "committed", "rolled_back"],
        description: "Filter by transaction status (optional)",
      },
    },
  },
  handler: async (args, deps) => {
    const a = args as Record<string, unknown>;
    const result = await deps.listTransactionsToolUseCase.execute({
      status: a.status as
        | "pending"
        | "speculative"
        | "committed"
        | "rolled_back"
        | undefined,
    });
    if (!result.success) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: String(result.error ?? "Unknown error"),
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
