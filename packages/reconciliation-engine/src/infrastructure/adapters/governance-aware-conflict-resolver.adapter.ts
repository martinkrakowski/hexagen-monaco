import type { ResolveConflictPort } from "../../application/ports/in/resolve-conflict.port.js";
import type { Patch } from "../../domain/llm-response.js";

const INVARIANT_PRESERVING_TYPES = new Set<Patch["type"]>([
  "add_node",
  "add_edge",
  "update_node",
  "update_edge",
]);

const DESTRUCTIVE_TYPES = new Set<Patch["type"]>([
  "remove_node",
  "remove_edge",
]);

const GOVERNANCE_CRITICAL_IDS = new Set(["shared-kernel", "governance"]);

export class GovernanceAwareConflictResolverAdapter implements ResolveConflictPort {
  resolveConflict(patchA: Patch, patchB: Patch): Patch {
    const aIsDestructive = DESTRUCTIVE_TYPES.has(patchA.type);
    const bIsDestructive = DESTRUCTIVE_TYPES.has(patchB.type);

    if (aIsDestructive && !bIsDestructive) return patchB;
    if (!aIsDestructive && bIsDestructive) return patchA;

    const aTargetsGovernance = GOVERNANCE_CRITICAL_IDS.has(patchA.targetId);
    const bTargetsGovernance = GOVERNANCE_CRITICAL_IDS.has(patchB.targetId);

    if (aTargetsGovernance && !bTargetsGovernance) return patchA;
    if (!aTargetsGovernance && bTargetsGovernance) return patchB;

    const aPreservesInvariant = INVARIANT_PRESERVING_TYPES.has(patchA.type);
    const bPreservesInvariant = INVARIANT_PRESERVING_TYPES.has(patchB.type);

    if (aPreservesInvariant && !bPreservesInvariant) return patchA;
    if (!aPreservesInvariant && bPreservesInvariant) return patchB;

    return patchA;
  }
}
