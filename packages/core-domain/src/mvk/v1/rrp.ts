/**
 * ResolvedRuleProgram (RRP) - MVK v1
 *
 * This file is part of the batched emission of MVK v1 TypeScript scaffold.
 * See mvk-compilation-pass: cp-2026-04-20-01
 */

import { Identifier } from "./domain-ast";
import { NodeKind } from "./node-kind";
import { EdgeKind } from "./edge-kind";

/**
 * ResolvedRuleProgram - The output of contextual resolution of governance rules
 * Represents the semantic truth after applying context to MVK contracts
 */
export interface ResolvedRuleProgram {
  /** Version of the RRP schema */
  version: string;
  /** Hash of the resolved context (workspace/user/deployment) */
  contextHash: string;
  /** Hash of the active governance rule set */
  ruleSetHash: string;
  /** Nodes after rule resolution */
  nodes: ResolvedNode[];
  /** Edges after rule resolution */
  edges: ResolvedEdge[];
  /** Topological order for deterministic processing */
  topologicalOrder: Identifier[];
}

/**
 * ResolvedNode - A node that has undergone rule resolution
 */
export interface ResolvedNode {
  /** Unique identifier */
  id: Identifier;
  /** Node kind */
  kind: NodeKind;
  /** Original attributes from MVK */
  attributes: Record<string, unknown>;
  /** Computed attributes from rule resolution */
  computedAttributes: Record<string, unknown>;
  /** Validity status after applying constraints */
  validity: {
    /** Whether the node is valid according to all invariants */
    valid: boolean;
    /** Human-readable descriptions of any violations */
    violations: string[];
  };
}

/**
 * ResolvedEdge - An edge that has undergone rule resolution
 */
export interface ResolvedEdge {
  /** Unique identifier */
  id: Identifier;
  /** Edge kind */
  kind: EdgeKind;
  /** Source node ID */
  source: Identifier;
  /** Target node ID */
  target: Identifier;
  /** Original attributes from MVK */
  attributes: Record<string, unknown>;
  /** Computed attributes from rule resolution */
  computedAttributes: Record<string, unknown>;
  /** Validity status after applying constraints */
  validity: {
    /** Whether the edge is valid according to all invariants */
    valid: boolean;
    /** Human-readable descriptions of any violations */
    violations: string[];
  };
}
