import type { Grant } from "../../../application/kernel/grant.js";
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
      grant: {
        type: "object",
        description:
          "The Grant authorizing this cycle (docs/kernel/GRANT.md). Required — an accept call with no grant is denied.",
      },
      goal_id: {
        type: "string",
        description:
          "Opaque id for what prompted this cycle; defaults to transaction_id.",
      },
    },
    required: ["transaction_id"],
  },
  handler: async (args, deps) => {
    const a = args as Record<string, unknown>;
    const result = await deps.acceptTransactionToolUseCase.execute({
      transaction_id: a.transaction_id as string,
      grant: a.grant as Grant | undefined,
      goal_id: a.goal_id as string | undefined,
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
