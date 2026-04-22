import type { ResolveConflictPort } from "../../application/ports/in/resolve-conflict.port.js";
import type { Patch } from "../../domain/llm-response.js";

export class DefaultConflictResolverAdapter implements ResolveConflictPort {
  private extractTimestamp(id: string): number {
    const match = id.match(/patch-(\d+)-/);
    return match ? parseInt(match[1], 10) : 0;
  }

  resolveConflict(patchA: Patch, patchB: Patch): Patch {
    const timestampA = this.extractTimestamp(patchA.id);
    const timestampB = this.extractTimestamp(patchB.id);

    // Prefer the patch with the later timestamp (newer)
    if (timestampA > timestampB) return patchA;
    if (timestampA < timestampB) return patchB;

    // If timestamps are equal, use the full ID for deterministic tie-breaking
    if (patchA.id > patchB.id) return patchA;
    if (patchA.id < patchB.id) return patchB;

    // This should not happen because IDs are unique, but return patchA as fallback
    return patchA;
  }
}
