import type { TransactionManagerPort } from "@hexagen/transaction-system";
import type { Result } from "@hexagen/shared";
import type {
  AcceptTransactionToolInput,
  AcceptTransactionToolPort,
  AcceptTransactionToolResult,
} from "../ports/in/accept-transaction-tool.port.js";

/**
 * AcceptTransactionToolUseCase — Mark transaction as accepted via MCP
 *
 * This tool only transitions the transaction state to "committed".
 * The actual patch application should be done by the web API accept endpoint.
 *
 * Use this when you want to programmatically accept a transaction that
 * has already been applied and validated.
 *
 * ADR-0048: implements the inbound `AcceptTransactionToolPort` the MCP handler
 * calls; is handed the outbound `TransactionManagerPort` an infrastructure
 * adapter implements.
 */
export class AcceptTransactionToolUseCase implements AcceptTransactionToolPort {
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
