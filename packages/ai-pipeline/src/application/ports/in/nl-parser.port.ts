/**
 * NLToDomainCommandParserPort - Inbound port for parsing natural language to domain commands
 *
 * This port defines the contract for converting natural language intent strings
 * into structured DomainCommand[] that can be executed by the architecture modification system.
 */

import type { Result } from "@hexagen/shared";
import type { DomainCommand } from "@hexagen/core-domain";

/**
 * Error returned when NL parsing fails
 */
export interface NLParsingError {
  code:
    | "PARSE_FAILED"
    | "AMBIGUOUS_INTENT"
    | "UNSUPPORTED_INTENT"
    | "INVALID_PARAMETERS"
    | "EMPTY_INPUT";
  message: string;
  originalText: string;
  suggestions?: string[];
}

/**
 * Metadata from a successful NL parse operation
 */
export interface NLParsingMetadata {
  /** Detected intent type (e.g., "create_bounded_context", "rename_context") */
  intentType: string;
  /** Extracted parameters from regex capture groups */
  parameters: Record<string, unknown>;
  /** Confidence score (0-1) indicating parse quality */
  confidence: number;
}

/**
 * Inbound port for parsing natural language to domain commands
 */
export interface NLToDomainCommandParserPort {
  /**
   * Parse natural language intent into structured domain commands
   *
   * @param intent - Natural language intent string (e.g., "Add a bounded context named billing")
   * @returns Promise resolving to Result containing DomainCommand[] or error
   *
   * @example
   * const result = await parser.parse("Add a bounded context named billing");
   * if (result.success) {
   *   console.log("Parsed commands:", result.value);
   * } else {
   *   console.error("Parse error:", result.error);
   * }
   */
  parse(intent: string): Promise<Result<DomainCommand[], NLParsingError>>;

  /**
   * Parse natural language intent and return commands with parsing metadata
   *
   * @param intent - Natural language intent string
   * @returns Promise resolving to Result containing DomainCommand[] and metadata, or error
   */
  parseWithMetadata(
    intent: string,
  ): Promise<
    Result<
      { commands: DomainCommand[]; metadata: NLParsingMetadata },
      NLParsingError
    >
  >;
}
