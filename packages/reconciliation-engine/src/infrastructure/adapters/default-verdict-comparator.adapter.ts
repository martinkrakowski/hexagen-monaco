import type { CompareVerdictsPort } from "../../application/ports/in/compare-verdicts.port.js";
import type { Verdict } from "../../domain/verdict.js";

export class DefaultVerdictComparatorAdapter implements CompareVerdictsPort {
  compareVerdicts(a: Verdict, b: Verdict): number {
    // Accepted verdicts are considered greater than non-accepted ones
    if (a.accepted && !b.accepted) return 1;
    if (!a.accepted && b.accepted) return -1;

    // If both have the same acceptance status, compare by timestamp (newer is greater)
    if (a.timestamp > b.timestamp) return 1;
    if (a.timestamp < b.timestamp) return -1;

    // If timestamps are equal, compare by ID to ensure deterministic ordering
    if (a.id > b.id) return 1;
    if (a.id < b.id) return -1;

    return 0;
  }
}
