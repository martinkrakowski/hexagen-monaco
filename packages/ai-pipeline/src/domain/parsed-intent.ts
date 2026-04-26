/**
 * ParsedIntent - Value object representing a parsed natural language intent
 *
 * Encapsulates an intent string parsed into structured form with confidence metrics.
 */

import type { DomainCommand } from "@hexagen/core-domain";

export interface ParsedIntent {
  /** Original natural language intent string */
  readonly originalText: string;

  /** Structured domain commands derived from the intent */
  readonly commands: DomainCommand[];

  /** Confidence score (0-1) indicating how confident the parser is in this interpretation */
  readonly confidence: number;

  /** Detected intent type (e.g., "create_node", "create_edge", "update_node") */
  readonly intentType: string;

  /** Extracted parameters from the intent (e.g., names, types, descriptions) */
  readonly parameters: Record<string, unknown>;

  /** Optional metadata about the parsing process */
  readonly metadata?: {
    /** Pattern used for matching */
    matchedPattern?: string;
    /** Any ambiguities detected */
    ambiguities?: string[];
    /** Raw tokens extracted during parsing */
    tokens?: string[];
  };
}

/**
 * Factory function to create a ParsedIntent value object
 */
export function createParsedIntent(
  originalText: string,
  commands: DomainCommand[],
  confidence: number,
  intentType: string,
  parameters: Record<string, unknown>,
  metadata?: ParsedIntent["metadata"],
): ParsedIntent {
  if (confidence < 0 || confidence > 1) {
    throw new Error("Confidence must be between 0 and 1");
  }

  return {
    originalText,
    commands,
    confidence,
    intentType,
    parameters,
    metadata,
  };
}
