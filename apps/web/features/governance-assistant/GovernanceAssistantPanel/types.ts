import type {
  Violation,
  AISuggestion,
  PrebakedQuestion,
} from "@hexagen/prompt-compiler";

/**
 * Transport-shaped types the presentational `view/` tree needs.
 *
 * They are re-exported from here rather than imported from `../hooks/*`
 * directly because `view/**` is lint-fenced against that directory — a fence
 * with no `allowTypeImports` escape hatch, so it cannot be widened by accident.
 * A type re-export is erased at build time and carries no transport with it.
 */
export type { CloudChatMessage } from "../hooks/useCloudLlm";
export type { ConnectionState } from "../hooks/useCloudConnection";

export interface ServerCapabilityNames {
  /**
   * Model answering governance Q&A. `undefined` until the capability probe
   * resolves — deliberately, so no surface prints a name the server never
   * confirmed.
   */
  chatModelName?: string;
  /**
   * Manifest generation may run on a different provider chain than the
   * assistant's Q&A model; the settings card surfaces both when they differ.
   */
  generationModelName?: string;
}

export interface GovernanceAssistantPanelProps {
  wizardData: unknown;
  currentStepIndex: number;
  violations: Violation[];
  suggestions: AISuggestion[];
  onRefresh: () => void;
  isLoading: boolean;
}

export type PanelView = "main" | "model-settings";
export type LLMMode = "local" | "cloud";
export type ActiveItem =
  | { type: "violation"; item: Violation }
  | { type: "suggestion"; item: AISuggestion }
  | null;

export interface StatusSectionProps {
  violations: Violation[];
  suggestions: AISuggestion[];
}

export interface ViolationsSectionProps {
  violations: Violation[];
  activeItem: ActiveItem;
  onSelectViolation: (violation: Violation) => void;
}

export interface SuggestionsSectionProps {
  suggestions: AISuggestion[];
  activeItem: ActiveItem;
  onSelectSuggestion: (suggestion: AISuggestion) => void;
}

export interface QuestionsSectionProps {
  displayQuestions: PrebakedQuestion[];
  activeItem: ActiveItem;
  isStreaming: boolean;
  isExpanded: (id: string) => boolean;
  onQuestionClick: (q: PrebakedQuestion) => void;
  conversationThread: Array<{
    id: string;
    answer: string;
    questionLabel?: string;
  }>;
  lastAssistantMessage: string;
  regeneratingEntryId: string | null;
  onRegenerate: (id: string) => void;
  followUpQuestions: PrebakedQuestion[];
  onFollowUpClick: (q: PrebakedQuestion) => void;
  threadLoaded: boolean;
}
