import type { ComplianceReport } from "../../../domain/entities/compliance-report";
import type { PolicyViolationError } from "../../../domain/entities/compliance-report";
import type { AssembledManifest } from "@hexagen/shared";
import type { Result } from "@hexagen/shared";

/**
 * Port: Policy Evaluator (OPA / Rego-based policy engine).
 * Evaluates assembled manifest against organizational policies.
 * Returns Result<T, E> — never throws.
 */
export interface IPolicyEvaluator {
  /**
   * Evaluate a manifest against organizational policies.
   * Returns compliance report or structured error.
   */
  evaluate(
    manifest: AssembledManifest,
  ): Promise<Result<ComplianceReport, PolicyViolationError>>;
}
