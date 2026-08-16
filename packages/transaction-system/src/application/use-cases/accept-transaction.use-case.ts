import type {
  Transaction,
  TransactionStatus,
} from "../../domain/transaction.js";
import { readPatchMetadata } from "../../domain/patch-metadata.js";
import type { TransactionManagerPort } from "../ports/in/transaction-manager.port.js";
import type { ManifestMutationPort } from "../ports/out/manifest-mutation.port.js";
import type { LintValidationPort } from "../ports/out/lint-validation.port.js";

/**
 * Every way the accept saga can end.
 *
 * Modelled as a discriminated union rather than `Result<T, Error>` because the
 * caller (an HTTP route) has to distinguish outcomes that are all "failure" but
 * map to very different responses — a 404, a 409, a 200-with-`success:false`
 * lint report, and three separate 500 classes. Flattening them into one `Error`
 * would force the route to pattern-match on message strings, which is how the
 * inline version ended up reporting an unrunnable linter as a lint violation.
 *
 * `restoreFailure` is present on a compensating arm when the git restore ALSO
 * failed. That is the "manual intervention required" state: the transaction is
 * still rolled back in memory, but the on-disk manifest may retain the patches.
 */
export type AcceptTransactionOutcome =
  | { kind: "accepted"; transaction: Transaction; patchesApplied: number }
  | { kind: "not-found" }
  | { kind: "wrong-state"; status: TransactionStatus }
  | { kind: "invalid-patch-metadata"; reason: string }
  | { kind: "apply-failed"; error: Error; restoreFailure?: Error }
  | { kind: "lint-violation"; lintErrors: string[]; restoreFailure?: Error }
  | { kind: "lint-unavailable"; error: Error; restoreFailure?: Error };

export interface AcceptTransactionRequest {
  readonly transactionId: string;
  /**
   * Absolute manifest path, already resolved against the workspace root the
   * mutation/lint adapters are anchored on. See {@link ManifestMutationPort} —
   * this use case does no path resolution of its own, because the anchor is a
   * delivery-side concern (the web app finds the monorepo root; a CLI caller
   * would not).
   */
  readonly manifestPath: string;
}

/**
 * AcceptTransactionUseCase — the commit half of the accept/reject saga
 * (AUD-004).
 *
 * Previously inline in `apps/web/app/api/architecture/modify/accept/route.ts`:
 * state-machine check → patch read → applyPatches → lint gate → git-restore
 * compensation → commit/rollback. Living in an HTTP handler meant it could only
 * be exercised through a mocked composition root, and that its compensation was
 * only as complete as whoever last edited the handler remembered to make it.
 *
 * The compensation invariant this class enforces on EVERY failing arm past the
 * point of mutation: the manifest is restored from git AND the transaction
 * leaves `speculative`. The inline version honoured that on the lint arm only —
 * a failed `applyPatches` returned 500 while leaving the transaction stuck
 * speculative and a possibly half-applied manifest on disk.
 */
export class AcceptTransactionUseCase {
  constructor(
    private readonly transactionManager: TransactionManagerPort,
    private readonly manifestMutation: ManifestMutationPort,
    private readonly lintValidation: LintValidationPort,
  ) {}

  async execute(
    request: AcceptTransactionRequest,
  ): Promise<AcceptTransactionOutcome> {
    const { transactionId, manifestPath } = request;

    const tx = this.transactionManager.get(transactionId);
    if (!tx) return { kind: "not-found" };
    if (tx.status !== "speculative") {
      return { kind: "wrong-state", status: tx.status };
    }

    const read = readPatchMetadata(tx.metadata);
    if (!read.ok) {
      // Nothing has been written to disk yet, so there is nothing to restore —
      // but the transaction must still leave `speculative`, or a producer bug
      // silently leaks a stuck transaction (and its backpressure slot) on every
      // accept attempt.
      this.transactionManager.rollback(
        transactionId,
        `Invalid patch metadata: ${read.reason}`,
      );
      return { kind: "invalid-patch-metadata", reason: read.reason };
    }
    const patches = read.patches;

    const applyResult = await this.manifestMutation.applyPatches(
      patches,
      manifestPath,
    );
    if (!applyResult.success) {
      // A failed apply is not necessarily a no-op apply: the adapter may have
      // written part of the patch set before failing. Compensate.
      return {
        kind: "apply-failed",
        error: applyResult.error,
        ...(await this.compensate(
          transactionId,
          manifestPath,
          `Patch application failed: ${applyResult.error.message}`,
        )),
      };
    }

    const lintResult = await this.lintValidation.validateManifest(manifestPath);

    // The linter COULD NOT RUN. Distinct from "the manifest is invalid": the
    // patches' validity is unknown, so the only safe move is to back them out
    // and say so. Folding this into the violation arm (as the inline version
    // did) reports an infrastructure outage to the operator as a content
    // problem, with an empty error list and an HTTP 200.
    if (!lintResult.success) {
      return {
        kind: "lint-unavailable",
        error: lintResult.error,
        ...(await this.compensate(
          transactionId,
          manifestPath,
          `Lint validation could not be run: ${lintResult.error.message}`,
        )),
      };
    }

    if (!lintResult.value.valid) {
      const lintErrors = lintResult.value.errors;
      return {
        kind: "lint-violation",
        lintErrors,
        ...(await this.compensate(
          transactionId,
          manifestPath,
          `Lint validation failed: ${lintErrors.join("; ")}`,
        )),
      };
    }

    const committed = this.transactionManager.commit(transactionId);
    return {
      kind: "accepted",
      transaction: committed ?? tx,
      patchesApplied: patches.length,
    };
  }

  /**
   * Undo a speculative accept: restore the manifest from git, then roll the
   * transaction back REGARDLESS of whether the restore succeeded.
   *
   * The ordering and the unconditional rollback are the Wave-1 (#441) guarantee
   * — an in-memory transaction must never be stranded in `speculative` because
   * an on-disk `git checkout` failed. The restore failure is reported back to
   * the caller instead of being swallowed, so it can be surfaced as its own
   * "manual intervention required" response.
   */
  private async compensate(
    transactionId: string,
    manifestPath: string,
    reason: string,
  ): Promise<{ restoreFailure?: Error }> {
    const restore = await this.manifestMutation.restoreFromGit(manifestPath);
    this.transactionManager.rollback(transactionId, reason);
    return restore.success ? {} : { restoreFailure: restore.error };
  }
}
