import type {
  Transaction,
  TransactionManagerPort,
} from "@hexagen/transaction-system";
import type { Result } from "@hexagen/shared";

export interface AcceptTransactionToolInput {
  transaction_id: string;
  reason?: string;
}

export interface AcceptTransactionToolResult {
  transaction: Transaction;
  previous_status: string;
  new_status: string;
}

/**
 * AcceptTransactionToolUseCase — Mark transaction as accepted via MCP
 *
 * This tool only transitions the transaction state to "committed".
 * The actual patch application should be done by the web API accept endpoint.
 *
 * Use this when you want to programmatically accept a transaction that
 * has already been applied and validated.
 */
export class AcceptTransactionToolUseCase {
  constructor(private readonly transactionManager: TransactionManagerPort) {}

  async execute(
    input: AcceptTransactionToolInput,
  ): Promise<Result<AcceptTransactionToolResult>> {
    try {
      const tx = this.transactionManager.get(input.transaction_id);

      if (!tx) {
        return {
          success: false,
          error: new Error(`Transaction ${input.transaction_id} not found`),
        };
      }

      const previousStatus = tx.status;

      // Commit the transaction
      const committed = this.transactionManager.commit(input.transaction_id);

      if (!committed) {
        return {
          success: false,
          error: new Error("Failed to commit transaction"),
        };
      }

      return {
        success: true,
        value: {
          transaction: committed,
          previous_status: previousStatus,
          new_status: committed.status,
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
