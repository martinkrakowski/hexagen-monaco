import type { DomainAST } from "@hexagen/core-domain";
import type { SpeculativeStateMachinePort } from "../../application/ports/out/speculative-state-machine.port.js";

/**
 * In-memory Speculative State Machine — maintains a stack of AST snapshots
 * for speculative execution with commit/rollback semantics.
 */
export class InMemorySpeculativeStateMachine implements SpeculativeStateMachinePort {
  private snapshots: Map<string, { ast: DomainAST; committed: boolean }> =
    new Map();
  private counter = 0;

  applySpeculative(ast: DomainAST, mutation: Record<string, unknown>): string {
    const snapshotId = `snapshot-${++this.counter}`;
    // Deep clone the AST and apply mutation metadata
    const cloned: DomainAST = JSON.parse(JSON.stringify(ast));
    // Store mutation metadata on the cloned AST for audit purposes
    (cloned as unknown as Record<string, unknown>).__mutation = mutation;
    (cloned as unknown as Record<string, unknown>).__snapshotId = snapshotId;
    this.snapshots.set(snapshotId, { ast: cloned, committed: false });
    return snapshotId;
  }

  commitSpeculative(snapshotId: string): boolean {
    const entry = this.snapshots.get(snapshotId);
    if (!entry) return false;
    entry.committed = true;
    return true;
  }

  rollbackSpeculative(snapshotId: string): boolean {
    return this.snapshots.delete(snapshotId);
  }

  getSpeculativeState(snapshotId: string): DomainAST | null {
    const entry = this.snapshots.get(snapshotId);
    return entry ? entry.ast : null;
  }
}
