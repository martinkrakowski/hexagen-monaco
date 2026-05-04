import type { ToolDefinition } from "./tool-definition.js";

export const rejectTransactionTool: ToolDefinition = {
  name: "hexagen_reject_transaction",
  description: "Reject a transaction and mark it as rolled back",
  inputSchema: {
    type: "object",
    properties: {
      transaction_id: {
        type: "string",
        description: "Transaction ID to reject",
      },
      reason: {
        type: "string",
        description: "Reason for rejection (optional)",
      },
    },
    required: ["transaction_id"],
  },
  handler: async (args, deps) => {
    const a = args as Record<string, unknown>;
    const result = await deps.rejectTransactionToolUseCase.execute({
      transaction_id: a.transaction_id as string,
      reason: a.reason as string | undefined,
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
