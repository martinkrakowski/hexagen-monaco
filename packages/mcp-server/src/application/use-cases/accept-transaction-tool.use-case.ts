import type { EventBusPort } from "@hexagen/messaging";
import type { Result } from "@hexagen/shared";
import type { TransactionManagerPort } from "@hexagen/transaction-system";
import {
  applyPendingManifestMutation,
  readPendingMutation,
} from "../pending-manifest-mutation.js";
import type {
  AcceptTransactionToolInput,
  AcceptTransactionToolPort,
  AcceptTransactionToolResult,
} from "../ports/in/accept-transaction-tool.port.js";
import type { ManifestWritePort } from "../ports/out/manifest-write.port.js";
import type { ScaffoldingPort } from "../ports/out/scaffolding.port.js";

function isTerminalStatus(status: string): boolean {
  return (
    status === "committed" || status === "rolled_back" || status === "failed"
  );
}

/**
 * AcceptTransactionToolUseCase — apply a pending manifest mutation, then
 * mark the transaction committed.
 *
 * Mutation tools no longer write the manifest themselves. Accept is the only
 * path that calls ManifestWritePort / ScaffoldingPort for those seven tools.
 */
export class AcceptTransactionToolUseCase implements AcceptTransactionToolPort {
  constructor(
    private readonly transactionManager: TransactionManagerPort,
    private readonly manifestWritePort: ManifestWritePort,
    private readonly scaffoldingPort: ScaffoldingPort,
    private readonly eventBusPort: EventBusPort,
  ) {}

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

      if (isTerminalStatus(tx.status)) {
        return {
          success: false,
          error: new Error(
            `Transaction ${input.transaction_id} is already ${tx.status}; refusing to apply`,
          ),
        };
      }

      const previousStatus = tx.status;
      const pending = readPendingMutation(tx);
      let applied: AcceptTransactionToolResult["applied"];

      if (pending) {
        applied = await applyPendingManifestMutation(pending, {
          manifestWrite: this.manifestWritePort,
          scaffolding: this.scaffoldingPort,
          eventBus: this.eventBusPort,
        });
      }

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
          applied,
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
