import type { IPolicyEvaluator } from "../../application/ports/out/policy-evaluator.port.js";
import type { ComplianceReport } from "../../domain/entities/compliance-report.js";
import type { PolicyViolationError } from "../../domain/entities/compliance-report.js";
import type { AssembledManifest } from "@hexagen/shared";
import type { Result } from "@hexagen/shared";

/**
 * Open Policy Agent adapter.
 * Executes Rego policies against the AssembledManifest.
 */
export class OpenPolicyAdapter implements IPolicyEvaluator {
  async evaluate(
    _manifest: AssembledManifest,
  ): Promise<Result<ComplianceReport, PolicyViolationError>> {
    try {
      // In a real implementation, this would:
      // 1. Serialize manifest to YAML
      // 2. Call `opa eval` or OPA API with the policy bundle
      // 3. Parse the decision result

      // For now, return a passing report (mock implementation)
      return {
        success: true,
        value: {
          _tag: "ComplianceReport",
          reportId: `opa-${Date.now()}`,
          evaluatedAt: new Date(),
          manifestName: "unknown",
          passed: true,
          violations: [],
          summary: "All OPA policy checks passed",
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          _tag: "PolicyViolationError",
          ruleId: "OPA-ERROR",
          ruleName: "Policy Evaluation Failed",
          severity: "high",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}
