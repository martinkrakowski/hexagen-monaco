import type {
  Transaction,
  TransactionStatus,
  RuleExecutionManifest,
} from "../../../domain/transaction.js";

/**
 * TransactionManagerPort — inbound port defining how the transaction system
 * is driven from the outside (e.g. by an intent bus or use-case orchestrator).
 */
export interface TransactionManagerPort {
  /** Begin a new transaction for the given intent */
  begin(
    intentId: string,
    metadata?: Record<string, unknown>,
    rem?: RuleExecutionManifest,
    lineage?: string[],
  ): Transaction;

  /** Transition a transaction to a new status */
  transition(
    transactionId: string,
    status: TransactionStatus,
  ): Transaction | null;

  /** Get the current state of a transaction */
  get(transactionId: string): Transaction | null;

  /** List all transactions with optional status filter */
  list(status?: TransactionStatus): Transaction[];

  /** Mark a transaction as committed */
  commit(transactionId: string): Transaction | null;

  /** Mark a transaction as rolled back */
  rollback(transactionId: string, reason?: string): Transaction | null;
}
