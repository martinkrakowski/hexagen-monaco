import type { DecisionAdvicePort } from "../../application/ports/out/decision-advice.port";
import type {
  DecisionAdviceRequest,
  DecisionAdviceResult,
} from "../../domain/decision-advice";

/**
 * The always-off adapter. Jev is off by default (invariant 1): with no
 * `JEV_API_KEY` the advice port is bound to this adapter, which never calls
 * out and always answers `unknown/disabled`.
 */
export class NullDecisionAdapter implements DecisionAdvicePort {
  ask(_request: DecisionAdviceRequest): Promise<DecisionAdviceResult> {
    return Promise.resolve({ status: "unknown", reason: "disabled" });
  }
}
