import type { EventBusPort } from "@hexagen/messaging";
import type { Result } from "@hexagen/shared";
import type { TransactionManagerPort } from "@hexagen/transaction-system";
import {
  checkGrantMode,
  checkGrantWindow,
  checkMutationAgainstGrant,
  deriveMutationRef,
  type Grant,
  type GrantCheck,
} from "../kernel/grant.js";
import type { HaltReason } from "../kernel/trace.js";
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
import type { TraceWritePort } from "../ports/out/trace-write.port.js";

function isTerminalStatus(status: string): boolean {
  return (
    status === "committed" || status === "rolled_back" || status === "failed"
  );
}

function haltReasonFor(reason: string): HaltReason {
  if (/revoked/i.test(reason)) return "grant_revoked";
  if (/expired/i.test(reason)) return "grant_expired";
  return "grant_denied";
}

/**
 * AcceptTransactionToolUseCase — apply a pending manifest mutation, then
 * mark the transaction committed.
 *
 * Mutation tools no longer write the manifest themselves. Accept is the only
 * path that calls ManifestWritePort / ScaffoldingPort for those seven tools.
 *
 * This is also the Grant enforcement choke point (docs/kernel/GRANT.md
 * "Enforcement point"): before any write port is touched, the caller-
 * supplied Grant is checked for presence, mode, expiry/revocation, and —
 * when the transaction carries a pending mutation — the mutation's tool,
 * context, and write path against the grant. Every accept or grant-deny
 * appends one Trace evidence line (docs/kernel/TRACE.md) via
 * `TraceWritePort`.
 */
export class AcceptTransactionToolUseCase implements AcceptTransactionToolPort {
  constructor(
    private readonly transactionManager: TransactionManagerPort,
    private readonly manifestWritePort: ManifestWritePort,
    private readonly scaffoldingPort: ScaffoldingPort,
    private readonly eventBusPort: EventBusPort,
    private readonly traceWritePort: TraceWritePort,
    private readonly now: () => Date = () => new Date(),
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

      const pending = readPendingMutation(tx);
      const grantCheck = this.checkGrant(input.grant, pending);

      if (!grantCheck.allowed) {
        const traceResult = await this.appendTrace(
          input,
          tx.id,
          pending,
          haltReasonFor(grantCheck.reason),
        );
        const reason = traceResult.success
          ? grantCheck.reason
          : `${grantCheck.reason}; additionally, trace evidence write failed: ${traceResult.error.message}`;
        return {
          success: false,
          error: new Error(reason),
        };
      }

      const claimed = this.transactionManager.compareAndSetStatus(
        input.transaction_id,
        "pending",
        "speculative",
      );

      if (!claimed) {
        return {
          success: false,
          error: new Error(
            `Transaction ${input.transaction_id} could not be claimed for processing`,
          ),
        };
      }

      const previousStatus = tx.status;
      let applied: AcceptTransactionToolResult["applied"];

      try {
        if (pending) {
          applied = await applyPendingManifestMutation(pending, {
            manifestWrite: this.manifestWritePort,
            scaffolding: this.scaffoldingPort,
            eventBus: this.eventBusPort,
          });
        }
      } catch (error) {
        this.transactionManager.fail(input.transaction_id, String(error));
        return { success: false, error: error as Error };
      }

      const committed = this.transactionManager.commit(input.transaction_id);

      if (!committed) {
        return {
          success: false,
          error: new Error("Failed to commit transaction"),
        };
      }

      const traceResult = await this.appendTrace(
        input,
        tx.id,
        pending,
        "completed",
      );

      return {
        success: true,
        value: {
          transaction: committed,
          previous_status: previousStatus,
          new_status: committed.status,
          applied,
          ...(traceResult.success
            ? {}
            : { trace_write_error: traceResult.error.message }),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error as Error,
      };
    }
  }

  /**
   * Grant present, mode "write", within its expiry/revocation window, and
   * — when there is a pending mutation to apply — that mutation's tool,
   * context, and write path are all within the grant. Fail closed: any
   * missing or failing check denies before `compareAndSetStatus` claims
   * the transaction, so nothing is written and no compensation is needed.
   */
  private checkGrant(
    grant: Grant | undefined,
    pending: ReturnType<typeof readPendingMutation>,
  ): GrantCheck {
    if (!grant) {
      return {
        allowed: false,
        reason: "No Grant supplied; refusing to accept",
      };
    }

    const modeCheck = checkGrantMode(grant);
    if (!modeCheck.allowed) return modeCheck;

    const windowCheck = checkGrantWindow(grant, this.now());
    if (!windowCheck.allowed) return windowCheck;

    if (pending) {
      const mutationCheck = checkMutationAgainstGrant(
        grant,
        deriveMutationRef(pending),
      );
      if (!mutationCheck.allowed) return mutationCheck;
    }

    return { allowed: true };
  }

  /**
   * Returns the write's own Result rather than swallowing it: a caller
   * that commits a mutation but loses its evidence line needs to know,
   * not be told a silent success (docs/kernel/TRACE.md — an accept
   * without a Trace line is a defect, one layer up from a write with no
   * grant check at all).
   */
  private async appendTrace(
    input: AcceptTransactionToolInput,
    transactionId: string,
    pending: ReturnType<typeof readPendingMutation>,
    haltReason: HaltReason,
  ): Promise<Result<void, Error>> {
    const grant = input.grant;
    if (!grant?.id) return { success: true, value: undefined };

    const toolName = pending
      ? deriveMutationRef(pending).tool
      : "hexagen_accept_transaction";
    const now = this.now().toISOString();

    return this.traceWritePort.appendLine({
      grant_id: grant.id,
      goal_id: input.goal_id ?? input.transaction_id,
      tool_call: {
        name: toolName,
        args: { transaction_id: input.transaction_id },
        result: { halt_reason: haltReason },
        time: now,
      },
      halt_reason: haltReason,
      transaction_ids: [transactionId],
      started_at: now,
      ended_at: now,
    });
  }
}
