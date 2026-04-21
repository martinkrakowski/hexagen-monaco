import type { GovernanceEntry } from "@hexagen/local-llm";
import type {
  Violation,
  AISuggestion,
} from "@/lib/governance-question-templates";

/** Alias preserved for backward compatibility with earlier consumers. */
export type ConversationEntry = GovernanceEntry;

/**
 * The item a user has selected to ask questions about. `null` means
 * they're working at step-level (no specific violation/suggestion).
 */
export type ActiveItem =
  | { type: "violation"; item: Violation }
  | { type: "suggestion"; item: AISuggestion };

/** Cap on conversation history passed to the LLM — keeps small-model prompts within budget. */
export const MAX_HISTORY_MESSAGES = 4;

/** System prompt for the governance assistant. */
export const GOVERNANCE_SYSTEM_PROMPT =
  "You are a Hexagonal Architecture expert assistant in HexaGen Monaco. Always respond in English. Answer questions concisely and helpfully. You have access to the user's project wizard context which describes their bounded contexts, governance settings, and peer mappings.";
