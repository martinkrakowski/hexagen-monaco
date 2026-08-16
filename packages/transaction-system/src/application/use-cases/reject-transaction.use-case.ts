import type {
  Transaction,
  TransactionStatus,
} from "../../domain/transaction.js";
import type { TransactionManagerPort } from "../ports/in/transaction-manager.port.js";
import type { ManifestMutationPort } from "../ports/out/manifest-mutation.port.js";

/** Every way the reject saga can end. See {@link AcceptTransactionOutcome}. */
export type RejectTransactionOutcome =
  | { kind: "rejected"; transaction: Transaction; reason: string }
  | { kind: "not-found" }
  | { kind: "wrong-state"; status: TransactionStatus }
  | { kind: "restore-failed"; error: Error; reason: string };

export interface RejectTransactionRequest {
  readonly transactionId: string;
  /** Absolute, already anchored — see `AcceptTransactionRequest.manifestPath`. */
  readonly manifestPath: string;
  readonly reason?: string;
}

/**
 * One default for both the rollback reason and the response. The inline handler
 * carried two ("User rejected" into `rollback`, "User rejected the changes"
 * into the body), so the audit trail and the client disagreed about why the
 * same transaction was rolled back.
 */
export const DEFAULT_REJECTION_REASON = "User rejected the changes";

/**
 * RejectTransactionUseCase — the rollback half of the accept/reject saga
 * (AUD-004).
 *
 * The git restore is DEFENSIVE: a speculative transaction should not have
 * touched the manifest yet, but the modification pipeline is the only thing
 * guaranteeing that, so reject restores anyway rather than trusting it. As in
 * {@link AcceptTransactionUseCase}, the in-memory rollback happens whether or
 * not the restore succeeded — a failed `git checkout` must not strand the
 * transaction in `speculative` (Wave-1 / #441).
 */
export class RejectTransactionUseCase {
  constructor(
    private readonly transactionManager: TransactionManagerPort,
    private readonly manifestMutation: ManifestMutationPort,
  ) {}

  async execute(
    request: RejectTransactionRequest,
  ): Promise<RejectTransactionOutcome> {
    const { transactionId, manifestPath } = request;
    const reason = request.reason ?? DEFAULT_REJECTION_REASON;

    const tx = this.transactionManager.get(transactionId);
    if (!tx) return { kind: "not-found" };
    if (tx.status !== "speculative") {
      return { kind: "wrong-state", status: tx.status };
    }

    const restore = await this.manifestMutation.restoreFromGit(manifestPath);
    const rolledBack = this.transactionManager.rollback(transactionId, reason);

    if (!restore.success) {
      return { kind: "restore-failed", error: restore.error, reason };
    }

    return { kind: "rejected", transaction: rolledBack ?? tx, reason };
  }
}
