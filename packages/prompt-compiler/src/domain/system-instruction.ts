import type { Identifier } from "@hexagen/shared";

/**
 * SystemInstruction represents a fixed set of instructions that guide the LLM's behavior
 * and response format. These are prepended to every prompt to establish context, role,
 * and constraints for the AI assistant.
 */
export interface SystemInstruction {
  id: Identifier;
  content: string;
  version: number;
  /**
   * Timestamp when this instruction was last updated
   */
  updatedAt: string;
}

/**
 * Creates a new SystemInstruction with a generated ID and current timestamp
 */
export function createSystemInstruction(
  content: string,
  version: number = 1,
): SystemInstruction {
  return {
    id: `sys-instruction-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 9)}`,
    content,
    version,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Updates an existing SystemInstruction with new content and increments version
 */
export function updateSystemInstruction(
  instruction: SystemInstruction,
  content: string,
): SystemInstruction {
  return {
    ...instruction,
    content,
    version: instruction.version + 1,
    updatedAt: new Date().toISOString(),
  };
}
