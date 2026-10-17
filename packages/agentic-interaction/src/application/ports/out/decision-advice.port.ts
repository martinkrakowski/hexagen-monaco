import type {
  DecisionAdviceRequest,
  DecisionAdviceResult,
} from "../../../domain/decision-advice";

/**
 * The Jev decision-advice outbound port (ADR-0048).
 *
 * `ask` either returns advice with answers per question id, or an `unknown`
 * result whose closed-set reason means "today's behaviour stands" (invariant 4).
 * Implementations must never throw for an expected failure — every failure is
 * an `unknown` reason.
 */
export interface DecisionAdvicePort {
  ask(request: DecisionAdviceRequest): Promise<DecisionAdviceResult>;
}
