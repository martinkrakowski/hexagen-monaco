import type { Transaction } from "../../domain/transaction.js";
import type { TransactionManagerPort } from "../ports/in/transaction-manager.port.js";
import type { Result } from "../result.js";

/**
 * CommitTransactionUseCase — promotes speculative → confirmed state.
 */
export class CommitTransactionUseCase {
  constructor(private readonly transactionManager: TransactionManagerPort) {}

  async execute(transactionId: string): Promise<Result<Transaction, Error>> {
    try {
      // Get the current transaction to check if it's speculative
      const transaction = this.transactionManager.get(transactionId);
      if (!transaction) {
        return {
          success: false,
          error: new Error(`Transaction ${transactionId} not found`),
        };
      }

      // Only allow committing speculative transactions
      if (transaction.status !== "speculative") {
        return {
          success: false,
          error: new Error(
            `Transaction ${transactionId} is not in speculative state`,
          ),
        };
      }

      // Transition the transaction to committed state
      const committedTx = this.transactionManager.transition(
        transactionId,
        "committed",
      );
      if (!committedTx) {
        return {
          success: false,
          error: new Error(
            `Failed to transition transaction ${transactionId} to committed`,
          ),
        };
      }

      return { success: true, value: committedTx };
    } catch (err) {
      return { success: false, error: err as Error };
    }
  }
}
