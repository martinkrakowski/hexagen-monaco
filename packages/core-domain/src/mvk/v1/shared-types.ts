/**
 * Shared Types for AI-Driven Architecture Modification Pipeline
 *
 * This module defines the core types used across the architecture modification
 * pipeline, enabling cross-package communication for LLM responses, patches,
 * and reconciliation results.
 */

// Re-export Identifier from domain-ast to avoid duplication
export type { Identifier } from "./domain-ast.js";

/**
 * ArchitectureGraphLike - Represents the architecture graph structure
 * containing nodes (contexts/components) and edges (relationships).
 */
export interface ArchitectureGraphLike {
  nodes: Array<{ id: string; label: string; type: string; status?: string }>;
  edges: Array<{
    source: string;
    target: string;
    relationship: string;
    isValid: boolean;
    violationReason?: string;
  }>;
}

/**
 * ProjectSpecLike - Represents the project specification structure
 * containing bounded contexts, governance rules, and peer mappings.
 */
export interface ProjectSpecLike {
  boundedContexts?: Array<{ id: string; name: string }>;
  externalContexts?: unknown[];
  governance?: unknown;
  peerMappings?: unknown[];
}

/**
 * StructuredLLMOutput - Represents the structured output from an LLM
 * containing the manifest, architecture graph, and reasoning.
 */
export interface StructuredLLMOutput {
  manifest: ProjectSpecLike;
  architectureGraph: ArchitectureGraphLike;
  reasoning: string;
}

/**
 * LLMResponse - Represents the raw response from an LLM API call
 * including content, finish reason, token usage, and metadata.
 */
export interface LLMResponse {
  id: string;
  content: string;
  finishReason: "stop" | "length" | "content_filter" | "error";
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  metadata?: Record<string, unknown>;
}

/**
 * Patch - Represents a single modification to apply to the architecture
 * (add/remove/update nodes or edges).
 */
export interface Patch {
  id: string;
  type:
    | "add_node"
    | "remove_node"
    | "add_edge"
    | "remove_edge"
    | "update_node"
    | "update_edge";
  targetId: string;
  payload: Record<string, unknown>;
}

/**
 * ReconciliationResult - Represents the result of reconciliation
 * between LLM output and current architecture state.
 */
export interface ReconciliationResult {
  success: boolean;
  patches: Patch[];
  errors: string[];
  summary: string;
}

/**
 * createPatch - Factory function to create a patch with auto-generated ID
 */
export function createPatch(
  type: Patch["type"],
  targetId: string,
  payload: Record<string, unknown>,
): Patch {
  return {
    id: `patch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    type,
    targetId,
    payload,
  };
}

/**
 * createReconciliationResult - Factory function to create a reconciliation result
 */
export function createReconciliationResult(
  success: boolean,
  patches: Patch[] = [],
  errors: string[] = [],
  summary: string = "",
): ReconciliationResult {
  return {
    success,
    patches,
    errors,
    summary:
      summary ||
      (success ? "Reconciliation completed" : "Reconciliation failed"),
  };
}
