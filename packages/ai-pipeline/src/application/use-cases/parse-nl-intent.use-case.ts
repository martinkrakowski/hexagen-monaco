/**
 * ParseNLIntentUseCase - Orchestrates NL intent parsing
 *
 * This use case accepts a natural language intent string,
 * delegates to the NLToDomainCommandParserPort, and returns
 * a structured ParsedIntent with confidence and commands.
 */

import type { Result } from "@hexagen/shared";
import type { ParsedIntent } from "../../domain/parsed-intent.js";
import { createParsedIntent } from "../../domain/parsed-intent.js";
import type {
  NLToDomainCommandParserPort,
  NLParsingError,
} from "../ports/in/nl-parser.port.js";

/**
 * Error returned by the use case
 */
export interface ParseNLIntentError {
  code: "PARSER_ERROR" | "INVALID_INPUT";
  message: string;
  innerError?: NLParsingError;
}

/**
 * ParseNLIntentUseCase - Main orchestrator for NL intent parsing
 */
export class ParseNLIntentUseCase {
  constructor(private readonly parser: NLToDomainCommandParserPort) {}

  /**
   * Parse a natural language intent and return structured ParsedIntent
   *
   * @param intent - Natural language intent string
   * @returns Promise resolving to Result<ParsedIntent> or error
   */
  async execute(
    intent: string,
  ): Promise<Result<ParsedIntent, ParseNLIntentError>> {
    // Validate input
    if (!intent || intent.trim().length === 0) {
      return {
        success: false,
        error: {
          code: "INVALID_INPUT",
          message: "Intent string cannot be empty",
        },
      };
    }

    const trimmedIntent = intent.trim();

    // Delegate to parser port with metadata for richer result
    const parseResult = await this.parser.parseWithMetadata(trimmedIntent);

    if (!parseResult.success) {
      return {
        success: false,
        error: {
          code: "PARSER_ERROR",
          message: parseResult.error.message,
          innerError: parseResult.error,
        },
      };
    }

    // Create ParsedIntent value object with metadata from parser
    const parsedIntent = createParsedIntent(
      trimmedIntent,
      parseResult.value.commands,
      parseResult.value.metadata.confidence,
      parseResult.value.metadata.intentType,
      parseResult.value.metadata.parameters,
      {
        matchedPattern: parseResult.value.metadata.intentType,
        tokens: trimmedIntent.split(/\s+/),
      },
    );

    return {
      success: true,
      value: parsedIntent,
    };
  }
}
