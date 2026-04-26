import type { Patch, IntentLineage } from "@hexagen/core-domain";
import type { Transaction } from "../../domain/transaction.js";
import type { TransactionManagerPort } from "../ports/in/transaction-manager.port.js";
import type { ManifestMutationPort } from "../ports/out/manifest-mutation.port.js";
import type { LintValidationPort } from "../ports/out/lint-validation.port.js";
import type { Result } from "../result.js";

export class CommitPatchesUseCase {
  constructor(
    private readonly transactionManager: TransactionManagerPort,
    private readonly manifestMutation: ManifestMutationPort,
    private readonly lintValidation: LintValidationPort,
  ) {}

  async execute(
    patches: Patch[],
    lineage: IntentLineage,
    manifestPath: string,
  ): Promise<Result<Transaction, Error>> {
    const transaction = this.transactionManager.begin(lineage.intentId, {
      intentId: lineage.intentId,
      origin: lineage.origin,
    });
    if (!transaction) {
      return {
        success: false,
        error: new Error("Failed to begin transaction"),
      };
    }

    try {
      this.transactionManager.transition(transaction.id, "speculative");

      const applyResult = await this.manifestMutation.applyPatches(
        patches,
        manifestPath,
      );
      if (!applyResult.success) {
        await this.manifestMutation.restoreFromGit(manifestPath);
        this.transactionManager.rollback(
          transaction.id,
          `Patch application failed: ${applyResult.error.message}`,
        );
        return { success: false, error: applyResult.error };
      }

      const validationResult =
        await this.lintValidation.validateManifest(manifestPath);
      if (!validationResult.success) {
        await this.manifestMutation.restoreFromGit(manifestPath);
        this.transactionManager.rollback(
          transaction.id,
          `Lint validation error: ${validationResult.error.message}`,
        );
        return { success: false, error: validationResult.error };
      }

      if (!validationResult.value.valid) {
        await this.manifestMutation.restoreFromGit(manifestPath);
        const reason = `Lint validation failed: ${validationResult.value.errors.join("; ")}`;
        this.transactionManager.rollback(transaction.id, reason);
        return { success: false, error: new Error(reason) };
      }

      const committedTx = this.transactionManager.commit(transaction.id);
      if (!committedTx) {
        return {
          success: false,
          error: new Error(`Failed to commit transaction ${transaction.id}`),
        };
      }

      return { success: true, value: committedTx };
    } catch (err) {
      await this.manifestMutation.restoreFromGit(manifestPath);
      this.transactionManager.rollback(
        transaction.id,
        `Unexpected error during commit: ${(err as Error).message}`,
      );
      return { success: false, error: err as Error };
    }
  }
}
