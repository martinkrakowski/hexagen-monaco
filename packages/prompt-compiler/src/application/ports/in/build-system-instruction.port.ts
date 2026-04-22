import type { DomainAST, Identifier } from "@hexagen/core-domain";
import type { SystemInstruction } from "../../../domain/index.js";

/**
 * Request to build a system instruction from domain AST and governance rules
 */
export interface BuildSystemInstructionRequest {
  /** Name for the system instruction */
  name: string;
  /** The domain AST to build context from */
  domainAST: DomainAST;
  /** Governance rules to include */
  governanceRules: string[];
  /** Optional template overrides */
  templateOverrides?: Record<string, string>;
}

/**
 * Port for building system instructions that guide LLM behavior
 */
export interface BuildSystemInstructionPort {
  /**
   * Build a system instruction from domain context
   * @param request Contains domain AST and governance rules
   * @returns Promise resolving to the built system instruction
   */
  build(request: BuildSystemInstructionRequest): Promise<SystemInstruction>;
}

/**
 * Type guard for BuildSystemInstructionPort
 */
export function isBuildSystemInstructionPort(
  port: unknown,
): port is BuildSystemInstructionPort {
  if (port === null || typeof port !== "object") return false;
  const p = port as Record<string, unknown>;
  return typeof p.build === "function";
}
