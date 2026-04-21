/**
 * RuleExecutionManifest (REM) - MVK v1
 *
 * This file is part of the batched emission of MVK v1 TypeScript scaffold.
 * See mvk-compilation-pass: cp-2026-04-20-01
 */

import { Identifier } from "./domain-ast";
import { NodeKind } from "./node-kind";
import { EdgeKind } from "./edge-kind";

/**
 * RuleExecutionManifest - A frozen snapshot of a resolved rule program
 * Represents an immutable, version-locked execution context
 */
export interface RuleExecutionManifest {
  /** Version of the REM schema */
  version: string;
  /** Hash of the resolved context (must match RRP.contextHash) */
  contextHash: string;
  /** Hash of the active governance rule set (must match RRP.ruleSetHash) */
  ruleSetHash: string;
  /** Hash of the source RRP (for integrity verification) */
  rrpHash: string;
  /** The manifested nodes and edges */
  manifest: {
    nodes: ManifestNode[];
    edges: ManifestEdge[];
  };
  /** Cryptographic seal ensuring immutability */
  seal: string; // HMAC-SHA256 of manifest contents using ruleSetHash as key
}

/**
 * ManifestNode - A node in the REM (simplified from ResolvedNode)
 */
export interface ManifestNode {
  /** Unique identifier */
  id: Identifier;
  /** Node kind */
  kind: NodeKind;
  /** Attributes (original + computed, but frozen) */
  attributes: Record<string, unknown>;
}

/**
 * ManifestEdge - An edge in the REM (simplified from ResolvedEdge)
 */
export interface ManifestEdge {
  /** Unique identifier */
  id: Identifier;
  /** Edge kind */
  kind: EdgeKind;
  /** Source node ID */
  source: Identifier;
  /** Target node ID */
  target: Identifier;
  /** Attributes (original + computed, but frozen) */
  attributes: Record<string, unknown>;
}
