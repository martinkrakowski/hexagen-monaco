import type { Result } from "@hexagen/shared";
import type { ChatMessage } from "../value-objects/index.js";
import type { GovernanceEntry } from "../value-objects/index.js";

/**
 * Port for persisting chat histories across browser sessions.
 * Driven port (infrastructure adapts to fulfill this contract).
 *
 * Handles two distinct persistence concerns:
 * - Global chat message history (all LLM conversations)
 * - Governance conversation threads (Q&A pairs scoped to wizard steps/violations)
 */
export interface ChatPersistencePort {
  /**
   * Load the global chat message history from persistent storage.
   * Returns empty array if no history exists.
   */
  loadChatHistory(): Promise<Result<ChatMessage[]>>;

  /**
   * Persist the global chat message history to storage.
   * Overwrites any existing history.
   */
  saveChatHistory(messages: ChatMessage[]): Promise<Result<void>>;

  /**
   * Clear the global chat message history from storage.
   */
  clearChatHistory(): Promise<Result<void>>;

  /**
   * Load a governance conversation thread by context key.
   * Context key format examples:
   * - "step:bounded_contexts" (wizard step)
   * - "violation:v-xyz" (specific violation)
   * Returns empty array if no thread exists for that key.
   */
  loadGovernanceThread(contextKey: string): Promise<Result<GovernanceEntry[]>>;

  /**
   * Persist a governance conversation thread by context key.
   * Overwrites any existing thread for that key.
   */
  saveGovernanceThread(
    contextKey: string,
    entries: GovernanceEntry[],
  ): Promise<Result<void>>;

  /**
   * Clear a specific governance conversation thread from storage.
   */
  clearGovernanceThread(contextKey: string): Promise<Result<void>>;
}
