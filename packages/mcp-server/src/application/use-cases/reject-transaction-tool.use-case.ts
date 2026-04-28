import type {
  Transaction,
  TransactionManagerPort,
} from "@hexagen/transaction-system";
import type { Result } from "@hexagen/shared";

export interface RejectTransactionToolInput {
  transaction_id: string;
  reason?: string;
}

export interface RejectTransactionToolResult {
  transaction: Transaction;
  previous_status: string;
  new_status: string;
  reason: string;
}

/**
 * RejectTransactionToolUseCase — Mark transaction as rejected via MCP
 *
 * This tool transitions the transaction state to "rolled_back".
 * The actual manifest restoration should be done by the web API reject endpoint.
 *
 * Use this when you want to programmatically reject a transaction.
 */
export class RejectTransactionToolUseCase {
  constructor(private readonly transactionManager: TransactionManagerPort) {}

  async execute(
    input: RejectTransactionToolInput,
  ): Promise<Result<RejectTransactionToolResult>> {
    try {
      const tx = this.transactionManager.get(input.transaction_id);

      if (!tx) {
        return {
          success: false,
          error: new Error(`Transaction ${input.transaction_id} not found`),
        };
      }

      const previousStatus = tx.status;
      const reason = input.reason ?? "Rejected by AI agent";

      // Rollback the transaction
      const rolledBack = this.transactionManager.rollback(
        input.transaction_id,
        reason,
      );

      if (!rolledBack) {
        return {
          success: false,
          error: new Error("Failed to rollback transaction"),
        };
      }

      return {
        success: true,
        value: {
          transaction: rolledBack,
          previous_status: previousStatus,
          new_status: rolledBack.status,
          reason,
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
