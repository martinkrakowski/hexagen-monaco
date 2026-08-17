import type { TransactionManagerPort } from "@hexagen/transaction-system";
import type { Result } from "@hexagen/shared";
import type {
  ListTransactionsToolInput,
  ListTransactionsToolPort,
  ListTransactionsToolResult,
} from "../ports/in/list-transactions-tool.port.js";

/**
 * ListTransactionsToolUseCase — List all transactions via MCP
 *
 * Allows AI agents to query all transactions, optionally filtered by status.
 * Useful for discovering pending transactions that need review.
 *
 * ADR-0048: implements the inbound `ListTransactionsToolPort` the MCP handler
 * calls; is handed the outbound `TransactionManagerPort` an infrastructure
 * adapter implements.
 */
export class ListTransactionsToolUseCase implements ListTransactionsToolPort {
  constructor(private readonly transactionManager: TransactionManagerPort) {}

  async execute(
    input: ListTransactionsToolInput = {},
  ): Promise<Result<ListTransactionsToolResult>> {
    try {
      const transactions = this.transactionManager.list(input.status);

      return {
        success: true,
        value: {
          transactions,
          count: transactions.length,
          filtered_by_status: input.status,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error as Error,
      };
    }
  }
}

// Made with Bob
