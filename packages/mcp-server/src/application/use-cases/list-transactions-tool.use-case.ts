import type {
  Transaction,
  TransactionStatus,
  TransactionManagerPort,
} from "@hexagen/transaction-system";
import type { Result } from "@hexagen/shared";

export interface ListTransactionsToolInput {
  status?: TransactionStatus;
}

export interface ListTransactionsToolResult {
  transactions: Transaction[];
  count: number;
  filtered_by_status?: TransactionStatus;
}

/**
 * ListTransactionsToolUseCase — List all transactions via MCP
 *
 * Allows AI agents to query all transactions, optionally filtered by status.
 * Useful for discovering pending transactions that need review.
 */
export class ListTransactionsToolUseCase {
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
