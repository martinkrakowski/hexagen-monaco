import type { EventBusPort } from "@hexagen/messaging";
import type { Result } from "@hexagen/shared";
import type {
  Transaction,
  TransactionManagerPort,
} from "@hexagen/transaction-system";
import {
  checkGrantMode,
  checkGrantWindow,
  checkMutationAgainstGrant,
  deriveMutationRef,
  type Grant,
  type GrantCheck,
} from "../kernel/grant.js";
import { checkGrantSignature } from "../kernel/grant-verification.js";
import type { HaltReason } from "../kernel/trace.js";
import {
  applyPendingManifestMutation,
  readPendingMutation,
  type AppliedMutation,
  type PendingManifestMutation,
} from "../pending-manifest-mutation.js";
import type {
  AcceptTransactionToolInput,
  AcceptTransactionToolPort,
  AcceptTransactionToolResult,
} from "../ports/in/accept-transaction-tool.port.js";
import type { GrantSignaturePort } from "../ports/out/grant-signature.port.js";
import type { ManifestWritePort } from "../ports/out/manifest-write.port.js";
import type { ScaffoldingPort } from "../ports/out/scaffolding.port.js";
import type { TraceWritePort } from "../ports/out/trace-write.port.js";

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
 *
 * This is also the Grant enforcement choke point (docs/kernel/GRANT.md
 * "Enforcement point"): before any write port is touched, the caller-
 * supplied Grant is verified against the trusted signing key (a grant this
 * repo never issued is never trusted, whatever fields it claims), then
 * checked for mode, expiry/revocation, and — when the transaction carries a
 * pending mutation — the mutation's tool, context, and write path(s).
 * Every accept, grant-deny, or failure appends one Trace evidence line
 * (docs/kernel/TRACE.md) via `TraceWritePort`.
 */
export class AcceptTransactionToolUseCase implements AcceptTransactionToolPort {
  constructor(
    private readonly transactionManager: TransactionManagerPort,
    private readonly manifestWritePort: ManifestWritePort,
    private readonly scaffoldingPort: ScaffoldingPort,
    private readonly eventBusPort: EventBusPort,
    private readonly traceWritePort: TraceWritePort,
    private readonly grantSignaturePort: GrantSignaturePort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(
    input: AcceptTransactionToolInput,
  ): Promise<Result<AcceptTransactionToolResult>> {
    let tx: Transaction | null = null;
    let pending: PendingManifestMutation | null = null;

    try {
      tx = this.transactionManager.get(input.transaction_id);

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

      pending = readPendingMutation(tx);
      const grantCheck = await this.checkGrant(input.grant, pending);

      if (!grantCheck.allowed) {
        const traceResult = await this.appendTrace(
          input,
          tx.id,
          pending,
          grantCheck.code,
          undefined,
          grantCheck.reason,
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
        await this.appendTrace(input, tx.id, pending, "error");
        return {
          success: false,
          error: new Error(
            `Transaction ${input.transaction_id} could not be claimed for processing`,
          ),
        };
      }

      const previousStatus = tx.status;
      let applied: AppliedMutation | undefined;

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
        await this.appendTrace(input, tx.id, pending, "error");
        return { success: false, error: error as Error };
      }

      const committed = this.transactionManager.commit(input.transaction_id);

      if (!committed) {
        await this.appendTrace(input, tx.id, pending, "error");
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
        applied,
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
      if (tx) {
        await this.appendTrace(input, tx.id, pending, "error");
      }
      return {
        success: false,
        error: error as Error,
      };
    }
  }

  /**
   * Grant present and signed by this repo's trusted issuer, mode "write",
   * within its expiry/revocation window, and — when there is a pending
   * mutation to apply — that mutation's tool, context, and write path(s)
   * are all within the grant. Fail closed: any missing or failing check
   * denies before `compareAndSetStatus` claims the transaction, so nothing
   * is written and no compensation is needed.
   *
   * The signature check runs first and independently of every other check:
   * a grant with every field a caller could want, but no valid signature,
   * is not "close" to authorized — it is exactly the self-asserted grant
   * docs/kernel/GRANT.md's "Enforcement point" warns is not enforcement at
   * all on its own. Scope checks below only run once provenance is settled.
   */
  private async checkGrant(
    grant: Grant | undefined,
    pending: PendingManifestMutation | null,
  ): Promise<GrantCheck> {
    const signatureCheck = await checkGrantSignature(
      grant,
      this.grantSignaturePort,
    );
    if (!signatureCheck.allowed) return signatureCheck;
    const verified = signatureCheck.grant;

    const modeCheck = checkGrantMode(verified);
    if (!modeCheck.allowed) return modeCheck;

    const windowCheck = checkGrantWindow(verified, this.now());
    if (!windowCheck.allowed) return windowCheck;

    if (pending) {
      const mutationCheck = checkMutationAgainstGrant(
        verified,
        deriveMutationRef(pending),
        pending,
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
   *
   * The call's `args`/`result` are the pending mutation's own input and
   * (when the mutation actually ran) its outcome — not the accept
   * wrapper's own `transaction_id`/halt_reason — so a reader digesting
   * this record's tool_call is verifying the named mutation's evidence,
   * not the accept call that carried it.
   */
  private async appendTrace(
    input: AcceptTransactionToolInput,
    transactionId: string,
    pending: PendingManifestMutation | null,
    haltReason: HaltReason,
    appliedResult?: AppliedMutation,
    denialReason?: string,
  ): Promise<Result<void, Error>> {
    const grant = input.grant;
    const toolName = pending
      ? deriveMutationRef(pending).tool
      : "hexagen_accept_transaction";
    const args: unknown = pending
      ? pending.input
      : { transaction_id: input.transaction_id };
    if (!grant?.id) {
      // No grant_id to cite, so this is its own record kind, never evidence of
      // a write. The adapter decides whether its trace can hold it.
      return this.traceWritePort.appendGrantMissing({
        tool: toolName,
        args,
        goal_id: input.goal_id,
        reason: denialReason ?? "no grant",
        time: this.now().toISOString(),
      });
    }
    const result: unknown = appliedResult ?? { halt_reason: haltReason };
    const now = this.now().toISOString();

    return this.traceWritePort.appendLine({
      grant_id: grant.id,
      goal_id: input.goal_id ?? input.transaction_id,
      tool_call: {
        name: toolName,
        args,
        result,
        time: now,
      },
      halt_reason: haltReason,
      transaction_ids: [transactionId],
      started_at: now,
      ended_at: now,
    });
  }
}
