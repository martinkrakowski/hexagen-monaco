import type { Transaction } from "../../domain/transaction.js";
import type { TransactionManagerPort } from "../ports/in/transaction-manager.port.js";
import type { Result } from "../result.js";

/**
 * ExecuteTransactionUseCase — binds intent + REM + lineage by beginning a transaction
 * and transitioning it to speculative state.
 */
export class ExecuteTransactionUseCase {
  constructor(private readonly transactionManager: TransactionManagerPort) {}

  async execute(
    intentId: string,
    rem: string, // JSON stringified manifest
    lineage: string[], // Array of previous intent IDs
    metadata: Record<string, unknown> = {},
  ): Promise<Result<Transaction, Error>> {
    try {
      // Begin a new transaction for the given intent
      const transaction = this.transactionManager.begin(intentId, metadata);
      if (!transaction) {
        return {
          success: false,
          error: new Error("Failed to begin transaction"),
        };
      }

      // Transition the transaction to speculative state
      const speculativeTx = this.transactionManager.transition(
        transaction.id,
        "speculative",
      );
      if (!speculativeTx) {
        return {
          success: false,
          error: new Error("Failed to transition transaction to speculative"),
        };
      }

      return { success: true, value: speculativeTx };
    } catch (err) {
      return { success: false, error: err as Error };
    }
  }
}
