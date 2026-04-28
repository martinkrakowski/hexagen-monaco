import type {
  Transaction,
  TransactionManagerPort,
} from "@hexagen/transaction-system";
import type { Result } from "@hexagen/shared";

export interface GetTransactionToolInput {
  transaction_id: string;
}

export interface GetTransactionToolResult {
  transaction: Transaction | null;
  found: boolean;
}

/**
 * GetTransactionToolUseCase — Query transaction state via MCP
 *
 * Allows AI agents to inspect transaction status, metadata, and patches
 * before deciding whether to accept or reject.
 */
export class GetTransactionToolUseCase {
  constructor(private readonly transactionManager: TransactionManagerPort) {}

  async execute(
    input: GetTransactionToolInput,
  ): Promise<Result<GetTransactionToolResult>> {
    try {
      const transaction = this.transactionManager.get(input.transaction_id);

      return {
        success: true,
        value: {
          transaction,
          found: transaction !== null,
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
