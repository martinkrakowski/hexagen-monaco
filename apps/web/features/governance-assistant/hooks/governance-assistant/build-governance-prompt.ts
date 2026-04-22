import type { WizardStepId } from "@hexagen/prompt-compiler";
import {
  buildViolationPrompt,
  buildSuggestionPrompt,
  buildStepPrompt,
  type PrebakedQuestion,
} from "@hexagen/prompt-compiler";

import type { ActiveItem } from "./types";

/**
 * Builds the LLM prompt for a governance question based on the
 * current active item type (violation / suggestion / step-level).
 *
 * Unifies the three branches of prompt construction that previously
 * appeared duplicated across askQuestion / askStepQuestion /
 * regenerateAnswer. Each call site now picks the question + context
 * and lets this helper dispatch on activeItem shape.
 */
export function buildGovernancePrompt(
  question: PrebakedQuestion,
  activeItem: ActiveItem | null,
  currentStepId: WizardStepId,
  wizardContext: string,
): string {
  if (activeItem?.type === "violation") {
    return buildViolationPrompt(question, activeItem.item, wizardContext);
  }
  if (activeItem?.type === "suggestion") {
    return buildSuggestionPrompt(question, activeItem.item, wizardContext);
  }
  return buildStepPrompt(question, currentStepId, wizardContext);
}
