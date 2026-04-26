/**
 * NLToDomainCommandParserAdapter - Concrete implementation of NLToDomainCommandParserPort
 *
 * This adapter converts natural language intent strings into DomainCommand[] using
 * regex pattern matching and extraction. Supports common patterns like:
 * - "Add a bounded context named [NAME]"
 * - "Add a port to [CONTEXT] named [PORT]"
 * - "Rename [CONTEXT] to [NEW_NAME]"
 */

import type { Result } from "@hexagen/shared";
import type { DomainCommand, Identifier } from "@hexagen/core-domain";
import { NodeKind, EdgeKind } from "@hexagen/core-domain";
import type {
  NLToDomainCommandParserPort,
  NLParsingError,
} from "../../application/ports/in/nl-parser.port.js";

/**
 * Regex for validating context names: lowercase letters, numbers, hyphens, underscores
 * Used as reference for pattern matching in NL intent parsing.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CONTEXT_NAME_REGEX = /^[a-z0-9_-]+$/;

/**
 * Pattern matching rule for NL intent
 */
interface PatternRule {
  pattern: RegExp;
  intentType: string;
  handler: (match: RegExpMatchArray) => DomainCommand[] | null;
}

/**
 * Concrete adapter for NL-to-DomainCommand parsing
 */
export class NLToDomainCommandParserAdapter implements NLToDomainCommandParserPort {
  private patterns: PatternRule[] = [];

  constructor() {
    this.patterns = [
      // Pattern 1: "Add a bounded context named [NAME]"
      {
        pattern:
          /add\s+a\s+bounded\s+context\s+named\s+([a-zA-Z_][a-zA-Z0-9_]*)/i,
        intentType: "create_bounded_context",
        handler: (match) => {
          const contextName = match[1];
          return [
            {
              type: "CreateNode",
              payload: {
                kind: NodeKind.BoundedContext,
                attributes: {
                  name: contextName,
                  description: `Bounded context: ${contextName}`,
                },
              },
            } as DomainCommand,
          ];
        },
      },

      // Pattern 2: "Add a port [TYPE] to [CONTEXT] named [PORT_NAME]"
      {
        pattern:
          /add\s+a\s+port\s+(?:\(([^)]+)\)\s+)?to\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+named\s+([a-zA-Z_][a-zA-Z0-9_]*)/i,
        intentType: "create_port",
        handler: (match) => {
          const portType = match[1] || "inbound";
          const contextName = match[2];
          const portName = match[3];

          return [
            {
              type: "CreateNode",
              payload: {
                kind: NodeKind.Port,
                attributes: {
                  name: portName,
                  portType,
                  parentContext: contextName,
                  description: `${portType.charAt(0).toUpperCase() + portType.slice(1)} port: ${portName}`,
                },
              },
            } as DomainCommand,
          ];
        },
      },

      // Pattern 3: "Rename [CONTEXT] to [NEW_NAME]"
      {
        pattern:
          /rename\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+to\s+([a-zA-Z_][a-zA-Z0-9_]*)/i,
        intentType: "rename_context",
        handler: (match) => {
          const oldName = match[1];
          const newName = match[2];

          // Note: This is a simplified implementation. In a real system,
          // we would need to resolve the oldName to a node ID first.
          // For now, we create an update command with oldName as proxy ID.
          return [
            {
              type: "UpdateNode",
              payload: {
                nodeId: oldName as Identifier,
                attributes: {
                  name: newName,
                },
              },
            } as DomainCommand,
          ];
        },
      },

      // Pattern 4: "Add an entity named [NAME] to [CONTEXT]"
      {
        pattern:
          /add\s+an\s+entity\s+named\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+to\s+([a-zA-Z_][a-zA-Z0-9_]*)/i,
        intentType: "create_entity",
        handler: (match) => {
          const entityName = match[1];
          const contextName = match[2];

          return [
            {
              type: "CreateNode",
              payload: {
                kind: NodeKind.Entity,
                attributes: {
                  name: entityName,
                  parentContext: contextName,
                  description: `Entity: ${entityName}`,
                },
              },
            } as DomainCommand,
          ];
        },
      },

      // Pattern 5: "Add a use case named [NAME] to [CONTEXT]"
      {
        pattern:
          /add\s+a\s+use\s+case\s+named\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+to\s+([a-zA-Z_][a-zA-Z0-9_]*)/i,
        intentType: "create_use_case",
        handler: (match) => {
          const useCaseName = match[1];
          const contextName = match[2];

          return [
            {
              type: "CreateNode",
              payload: {
                kind: NodeKind.UseCase,
                attributes: {
                  name: useCaseName,
                  parentContext: contextName,
                  description: `Use case: ${useCaseName}`,
                },
              },
            } as DomainCommand,
          ];
        },
      },

      // Pattern 6: "Create a/an link/edge from [SOURCE] to [TARGET]"
      {
        pattern:
          /create\s+an?\s+(?:link|edge)\s+from\s+([a-zA-Z0-9_-]+)\s+to\s+([a-zA-Z0-9_-]+)/i,
        intentType: "create_edge",
        handler: (match) => {
          const source = match[1];
          const target = match[2];

          return [
            {
              type: "CreateEdge",
              payload: {
                kind: EdgeKind.Dependency,
                source: source as Identifier,
                target: target as Identifier,
                attributes: {
                  description: `Link from ${source} to ${target}`,
                },
              },
            } as DomainCommand,
          ];
        },
      },

      // Pattern 7: "Update/Modify/Change context [NAME] to [PROPERTY]"
      {
        pattern:
          /(?:update|modify|change)\s+(?:the\s+)?(?:bounded\s+)?(?:context\s+)?([a-zA-Z0-9_-]+)\s+(?:(?:context|infrastructure)\s+)?to\s+(.+)/i,
        intentType: "update_context",
        handler: (match) => {
          const contextId = match[1];
          const property = match[2].trim();

          return [
            {
              type: "UpdateNode",
              payload: {
                nodeId: contextId as Identifier,
                attributes: {
                  configuration: property,
                  description: `Updated to: ${property}`,
                },
              },
            } as DomainCommand,
          ];
        },
      },
    ];
  }

  async parse(
    intent: string,
  ): Promise<Result<DomainCommand[], NLParsingError>> {
    if (!intent || intent.trim().length === 0) {
      return {
        success: false,
        error: {
          code: "EMPTY_INPUT",
          message: "Intent string cannot be empty",
          originalText: intent,
        },
      };
    }

    // Try each pattern in order
    for (const rule of this.patterns) {
      const match = intent.match(rule.pattern);
      if (match) {
        const commands = rule.handler(match);
        if (commands) {
          return {
            success: true,
            value: commands,
          };
        }
      }
    }

    // No pattern matched
    return {
      success: false,
      error: {
        code: "UNSUPPORTED_INTENT",
        message: `Could not parse intent: "${intent}"`,
        originalText: intent,
        suggestions: [
          'Try: "Add a bounded context named <name>"',
          'Try: "Add a port to <context> named <port>"',
          'Try: "Rename <old> to <new>"',
          'Try: "Add an entity named <name> to <context>"',
          'Try: "Create a link from <source> to <target>"',
          'Try: "Update <context> to <property>"',
        ],
      },
    };
  }
}
