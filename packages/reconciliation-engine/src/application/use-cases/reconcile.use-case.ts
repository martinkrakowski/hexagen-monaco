import type { ReconciliationPort } from "../ports/in/reconcile.port.js";
import type { CompareVerdictsPort } from "../ports/in/compare-verdicts.port.js";
import type { ResolveConflictPort } from "../ports/in/resolve-conflict.port.js";
import type { PromoteStatePort } from "../ports/in/promote-state.port.js";
import type {
  LintFilterPort,
  LinterReportLike,
  LintViolationLike,
} from "../ports/in/lint-filter.port.js";
import type { ManifestPatchPort } from "../ports/out/manifest-patch.port.js";
import type { ReconcileRequest } from "../ports/in/reconcile.port.js";
import type { Patch, ReconciliationResult } from "../../domain/llm-response.js";
import type { Verdict } from "../../domain/verdict.js";
import type { ReconciliationState } from "../../domain/reconciliation-state.js";
import { createVerdict } from "../../domain/verdict.js";
import { createInitialState } from "../../domain/reconciliation-state.js";

export class ReconcileUseCase {
  constructor(
    private readonly reconciliationPort: ReconciliationPort,
    private readonly compareVerdictsPort: CompareVerdictsPort,
    private readonly resolveConflictPort: ResolveConflictPort,
    private readonly promoteStatePort: PromoteStatePort,
    private readonly manifestPatchPort?: ManifestPatchPort,
    private readonly lintFilterPort?: LintFilterPort,
  ) {}

  async execute(
    request: ReconcileRequest,
    manifestPath?: string,
    linterReport?: LinterReportLike,
  ): Promise<ReconciliationResult> {
    let state: ReconciliationState = createInitialState();

    state = { ...state, version: state.version + 1, lastUpdated: Date.now() };

    const diffResult = await this.reconciliationPort.reconcile(request);

    if (!diffResult.success) {
      return diffResult;
    }

    state = { ...state, version: state.version + 1, lastUpdated: Date.now() };

    let patches = diffResult.patches;

    if (this.lintFilterPort && linterReport) {
      patches = this.lintFilterPort.filterPatches(patches, linterReport);
    }

    const verdicts = this.generateVerdicts(patches, linterReport);

    const sortedVerdicts = this.sortVerdicts(verdicts);

    const resolvedVerdicts = this.resolvePatchConflicts(sortedVerdicts);

    const acceptedVerdicts = resolvedVerdicts.filter((v) => v.accepted);

    if (acceptedVerdicts.length > 0) {
      state = this.promoteStatePort.promoteToPhase(state, "approved");
    }

    const finalPatches = this.extractAcceptedPatches(patches, acceptedVerdicts);

    if (this.manifestPatchPort && manifestPath) {
      const validation = await this.manifestPatchPort.validatePatches(
        finalPatches,
        request.currentManifest,
      );

      if (validation.success) {
        await this.manifestPatchPort.applyPatches(
          validation.value,
          manifestPath,
        );
      }
    }

    const rejectedCount = diffResult.patches.length - finalPatches.length;
    return {
      success: true,
      patches: finalPatches,
      errors: diffResult.errors,
      summary: `Reconciliation complete: ${finalPatches.length} patches applied, ${rejectedCount} rejected`,
    };
  }

  private generateVerdicts(
    patches: Patch[],
    linterReport?: LinterReportLike,
  ): Verdict[] {
    return patches.map((patch) => {
      if (this.hasErrorViolation(patch, linterReport)) {
        const violation = this.findErrorViolation(patch, linterReport!);
        return createVerdict(
          patch.id,
          false,
          `Blocked by lint: ${violation!.file}`,
        );
      }
      return createVerdict(patch.id, true, `Auto-accepted patch ${patch.id}`);
    });
  }

  private hasErrorViolation(patch: Patch, report?: LinterReportLike): boolean {
    if (!report) return false;
    return report.violations.some(
      (v) =>
        v.severity === "error" &&
        (v.file === patch.targetId ||
          v.file === patch.payload.file ||
          v.file === patch.payload.target),
    );
  }

  private findErrorViolation(
    patch: Patch,
    report: LinterReportLike,
  ): LintViolationLike | undefined {
    return report.violations.find(
      (v) =>
        v.severity === "error" &&
        (v.file === patch.targetId ||
          v.file === patch.payload.file ||
          v.file === patch.payload.target),
    );
  }

  private sortVerdicts(verdicts: Verdict[]): Verdict[] {
    return [...verdicts].sort((a, b) =>
      this.compareVerdictsPort.compareVerdicts(a, b),
    );
  }

  private resolvePatchConflicts(verdicts: Verdict[]): Verdict[] {
    return verdicts.filter((verdict) => verdict.accepted);
  }

  private extractAcceptedPatches(
    allPatches: Patch[],
    acceptedVerdicts: Verdict[],
  ): Patch[] {
    const acceptedPatchIds = new Set(acceptedVerdicts.map((v) => v.patchId));
    return allPatches.filter((p) => acceptedPatchIds.has(p.id));
  }
}
