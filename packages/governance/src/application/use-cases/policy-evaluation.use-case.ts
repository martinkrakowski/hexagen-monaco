import type { IPolicyEvaluator } from "../ports/out/policy-evaluator.port.js";
import type {
  ComplianceReport,
  PolicyViolationError,
} from "../../domain/entities/compliance-report.js";
import type { AssembledManifest, Result } from "@hexagen/shared";
import { err } from "@hexagen/shared";

export class PolicyEvaluationUseCase {
  constructor(private readonly evaluator: IPolicyEvaluator) {}

  async execute(
    manifest: AssembledManifest,
  ): Promise<Result<ComplianceReport, PolicyViolationError | Error>> {
    try {
      const result = await this.evaluator.evaluate(manifest);

      if (!result.success) {
        return result; // Already a Result.err()
      }

      return { success: true, value: result.value };
    } catch (error) {
      return err(
        new Error(
          `Policy evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  }
}

/**
 * Stage 7 wrapper: runs policy evaluation as part of the pipeline.
 * Returns the compliance report or triggers a pipeline error.
 */
export async function runStage7PolicyEvaluation(
  useCase: PolicyEvaluationUseCase,
  manifest: AssembledManifest,
): Promise<Result<ComplianceReport, PolicyViolationError | Error>> {
  return useCase.execute(manifest);
}
