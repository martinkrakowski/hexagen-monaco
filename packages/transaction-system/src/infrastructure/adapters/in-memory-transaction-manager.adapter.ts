import type {
  Transaction,
  TransactionStatus,
  RuleExecutionManifest,
} from "../../domain/transaction.js";
import {
  createTransaction,
  transitionTransaction,
  detectConflicts,
} from "../../domain/transaction.js";
import type { TransactionManagerPort } from "../../application/ports/in/transaction-manager.port.js";
import type { BackpressureControllerPort } from "../../application/ports/out/backpressure-controller.port.js";
import type { SpeculativeStateMachinePort } from "../../application/ports/out/speculative-state-machine.port.js";
import type { SemanticCachePort } from "../../application/ports/out/semantic-cache.port.js";
import type { BackpressureSignal } from "../../domain/value-objects/backpressure-signal.js";
import {
  isNone,
  isCoalesce,
  isDrop,
} from "../../domain/value-objects/backpressure-signal.js";

/**
 * In-memory Transaction Manager — stores transactions in a Map and
 * orchestrates backpressure control, speculative state, and semantic caching.
 */
export class InMemoryTransactionManager implements TransactionManagerPort {
  private transactions: Map<string, Transaction> = new Map();
  private readonly backpressureController?: BackpressureControllerPort;
  private readonly speculativeStateMachine?: SpeculativeStateMachinePort;
  private readonly semanticCache?: SemanticCachePort;

  constructor(deps?: {
    backpressureController?: BackpressureControllerPort;
    speculativeStateMachine?: SpeculativeStateMachinePort;
    semanticCache?: SemanticCachePort;
  }) {
    this.backpressureController = deps?.backpressureController;
    this.speculativeStateMachine = deps?.speculativeStateMachine;
    this.semanticCache = deps?.semanticCache;
  }

  begin(
    intentId: string,
    metadata: Record<string, unknown> = {},
    rem?: RuleExecutionManifest,
    lineage?: string[],
  ): Transaction {
    if (this.backpressureController) {
      const signal = this.backpressureController.accept(intentId);
      if (signal.tag === "drop") {
        throw new Error(`Transaction rejected: ${signal.reason}`);
      }
    }

    // Enhance metadata with REM and lineage if provided
    const enhancedMetadata = {
      ...metadata,
      ...(rem && { rem }),
      ...(lineage && { lineage }),
    };

    const tx = createTransaction(intentId, enhancedMetadata);

    // NEW: Validate lineage
    if (lineage && lineage.length > 0) {
      const priorIntent = lineage[lineage.length - 1];
      const priorTx = Array.from(this.transactions.values()).find(
        (t) => t.intentId === priorIntent,
      );
      if (!priorTx) {
        console.warn(
          `[Lineage] Prior intent ${priorIntent} not found in transaction store`,
        );
      }
    }

    // NEW: Detect conflicts if REM provided
    if (rem) {
      const conflictSet = detectConflicts(tx, rem);
      if (conflictSet.hasConflicts) {
        conflictSet.conflicts.forEach((conflict) => {
          console.log(
            `[ConflictDetection] ${conflict.severity}: ${conflict.message}`,
          );
        });
        // Store conflicts in transaction metadata for later inspection
        tx.metadata.conflicts = conflictSet;
      }
    }

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
    const tx = this.transactions.get(transactionId);
    if (!tx) return null;

    if (this.speculativeStateMachine) {
      const snapshotId = tx.metadata.snapshotId as string | undefined;
      if (snapshotId) {
        this.speculativeStateMachine.commitSpeculative(snapshotId);
      }
    }

    const updated = transitionTransaction(tx, "committed");
    this.transactions.set(transactionId, updated);

    if (this.backpressureController) {
      this.backpressureController.complete(tx.intentId);
    }

    return updated;
  }

  rollback(transactionId: string, _reason?: string): Transaction | null {
    const tx = this.transactions.get(transactionId);
    if (!tx) return null;

    if (this.speculativeStateMachine) {
      const snapshotId = tx.metadata.snapshotId as string | undefined;
      if (snapshotId) {
        this.speculativeStateMachine.rollbackSpeculative(snapshotId);
      }
    }

    const updated = transitionTransaction(tx, "rolled_back");
    this.transactions.set(transactionId, updated);

    if (this.backpressureController) {
      this.backpressureController.complete(tx.intentId);
    }

    return updated;
  }
}
