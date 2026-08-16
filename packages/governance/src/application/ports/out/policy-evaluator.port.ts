import type { ComplianceReport } from "../../../domain/entities/compliance-report";
import type { PolicyViolationError } from "../../../domain/entities/compliance-report";
import type { AssembledManifest } from "@hexagen/shared";
import type { Result } from "@hexagen/shared";

/**
 * Outbound (driven) port: Policy Evaluator (OPA / Rego-based policy engine).
 *
 * Direction per ADR-0048: the application layer *depends on* this contract and
 * an infrastructure adapter *implements* it — `OpenPolicyAdapter`
 * (`src/infrastructure/adapters/open-policy.adapter.ts`) is the current
 * implementer. That is what makes it driven, hence `ports/out` rather than
 * `ports/in`.
 *
 * Evaluates an assembled manifest against organizational policies.
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
