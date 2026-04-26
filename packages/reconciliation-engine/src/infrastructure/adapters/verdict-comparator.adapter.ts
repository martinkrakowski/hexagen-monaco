import type { CompareVerdictsPort } from "../../application/ports/in/compare-verdicts.port.js";
import type { Verdict } from "../../domain/verdict.js";

const GOVERNANCE_BLOCKED_KEYWORDS = [
  "shared-kernel-removal",
  "cross-boundary-port-injection",
  "invariant-violation",
];

export class VerdictComparatorAdapter implements CompareVerdictsPort {
  compareVerdicts(a: Verdict, b: Verdict): number {
    const aBlocked = this.hasGovernanceBlock(a);
    const bBlocked = this.hasGovernanceBlock(b);

    if (aBlocked && !bBlocked) return 1;
    if (!aBlocked && bBlocked) return -1;

    if (a.accepted && !b.accepted) return -1;
    if (!a.accepted && b.accepted) return 1;

    if (a.timestamp !== b.timestamp) {
      return a.timestamp < b.timestamp ? -1 : 1;
    }

    return 0;
  }

  private hasGovernanceBlock(verdict: Verdict): boolean {
    const reason = verdict.reason.toLowerCase();
    return GOVERNANCE_BLOCKED_KEYWORDS.some((keyword) =>
      reason.includes(keyword),
    );
  }
}
