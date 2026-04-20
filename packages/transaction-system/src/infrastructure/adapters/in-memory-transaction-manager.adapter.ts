import type {
  Transaction,
  TransactionStatus,
} from "../../domain/transaction.js";
import {
  createTransaction,
  transitionTransaction,
} from "../../domain/transaction.js";
import type { TransactionManagerPort } from "../../application/ports/in/transaction-manager.port.js";

/**
 * In-memory Transaction Manager — stores transactions in a Map.
 * In production this would be backed by persistent storage.
 */
export class InMemoryTransactionManager implements TransactionManagerPort {
  private transactions: Map<string, Transaction> = new Map();

  begin(intentId: string, metadata: Record<string, unknown> = {}): Transaction {
    const tx = createTransaction(intentId, metadata);
    this.transactions.set(tx.id, tx);
    return tx;
  }

  transition(
    transactionId: string,
    status: TransactionStatus,
  ): Transaction | null {
    const tx = this.transactions.get(transactionId);
    if (!tx) return null;

    const updated = transitionTransaction(tx, status);
    this.transactions.set(transactionId, updated);
    return updated;
  }

  get(transactionId: string): Transaction | null {
    return this.transactions.get(transactionId) ?? null;
  }

  list(status?: TransactionStatus): Transaction[] {
    const all = Array.from(this.transactions.values());
    if (!status) return all;
    return all.filter((tx) => tx.status === status);
  }

  commit(transactionId: string): Transaction | null {
    return this.transition(transactionId, "committed");
  }

  rollback(transactionId: string, _reason?: string): Transaction | null {
    return this.transition(transactionId, "rolled_back");
  }
}
