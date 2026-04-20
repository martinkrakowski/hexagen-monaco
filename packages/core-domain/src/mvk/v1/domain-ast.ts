/**
 * Domain Abstract Syntax Tree (DomainAST) - MVK v1
 * 
 * This file is part of the batched emission of MVK v1 TypeScript scaffold.
 * See mvk-compilation-pass: cp-2026-04-20-01
 */

export interface DomainAST {
  nodes: DomainNode[];
  edges: DomainEdge[];
  invariants: Invariants;
}

export interface DomainNode {
  id: Identifier;
  kind: NodeKind;
  attributes: Record<string, unknown>;
}

export interface DomainEdge {
  id: Identifier;
  kind: EdgeKind;
  source: Identifier;
  target: Identifier;
  attributes: Record<string, unknown>;
}

export interface Invariants {
  topology: TopologyInvariants[];
  cardinality: CardinalityInvariants[];
}

/**
 * Identifier - A unique identifier for nodes and edges.
 * In MVK v1, we use string identifiers, but this may evolve to a UUID or branded type.
 */
export type Identifier = string;