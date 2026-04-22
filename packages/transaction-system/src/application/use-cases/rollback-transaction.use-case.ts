import type { Transaction } from "../../domain/transaction.js";
import type { TransactionManagerPort } from "../ports/in/transaction-manager.port.js";
import type { Result } from "../result.js";

/**
 * RollbackTransactionUseCase — handles stale REM recovery by marking a transaction as rolled back.
 */
export class RollbackTransactionUseCase {
  constructor(private readonly transactionManager: TransactionManagerPort) {}

  async execute(
    transactionId: string,
    reason: string = "REM became stale",
  ): Promise<Result<Transaction, Error>> {
    try {
      // Mark the transaction as rolled back
      const transaction = this.transactionManager.rollback(
        transactionId,
        reason,
      );
      if (!transaction) {
        return {
          success: false,
          error: new Error(`Transaction ${transactionId} not found`),
        };
      }

      return { success: true, value: transaction };
    } catch (err) {
      return { success: false, error: err as Error };
    }
  }
}
