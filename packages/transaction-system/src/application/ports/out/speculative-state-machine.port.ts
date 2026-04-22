import type { DomainAST } from "@hexagen/core-domain";

/**
 * SpeculativeStateMachinePort — outbound port for applying speculative
 * mutations to the domain AST and rolling them back on failure.
 */
export interface SpeculativeStateMachinePort {
  /** Apply a speculative mutation to the AST, returning a snapshot id */
  applySpeculative(ast: DomainAST, mutation: Record<string, unknown>): string;

  /** Commit a speculative mutation, making it permanent */
  commitSpeculative(snapshotId: string): boolean;

  /** Roll back a speculative mutation */
  rollbackSpeculative(snapshotId: string): boolean;

  /** Get the current speculative state for a snapshot */
  getSpeculativeState(snapshotId: string): DomainAST | null;
}
