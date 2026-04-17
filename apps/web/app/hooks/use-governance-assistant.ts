"use client";

import { useState, useCallback, useMemo } from "react";
import type { WizardData } from "@hexagen/shared";
import { useLocalLLM } from "./use-local-llm";
import {
  type Violation,
  type AISuggestion,
  type PrebakedQuestion,
  type WizardStepId,
  VIOLATION_QUESTIONS,
  SUGGESTION_QUESTIONS,
  STEP_QUESTIONS,
  buildViolationPrompt,
  buildSuggestionPrompt,
  buildStepPrompt,
} from "@/lib/governance-question-templates";
import { serializeWizardContext } from "@/lib/wizard-assistant-context";
import { wizardSteps } from "@/components/project-wizard/config";

const GOVERNANCE_SYSTEM_PROMPT =
  "You are a Hexagonal Architecture expert assistant in HexaGen Monaco. Answer questions concisely and helpfully. You have access to the user's project wizard context which describes their bounded contexts, governance settings, and peer mappings.";

export type ActiveItem =
  | { type: "violation"; item: Violation }
  | { type: "suggestion"; item: AISuggestion };

export function useGovernanceAssistant(
  wizardData: WizardData,
  currentStepIndex: number,
) {
  const { sendGovernanceMessage, engineState, isStreaming } = useLocalLLM();
  const [activeItem, setActiveItem] = useState<ActiveItem | null>(null);

  const wizardContext = serializeWizardContext(wizardData);

  const currentStepId = useMemo<WizardStepId>(() => {
    const step = wizardSteps[currentStepIndex];
    return (step?.id as WizardStepId) ?? "workspace_governance";
  }, [currentStepIndex]);

  const stepQuestions = useMemo<PrebakedQuestion[]>(() => {
    return STEP_QUESTIONS[currentStepId] ?? [];
  }, [currentStepId]);

  const selectItem = useCallback((item: ActiveItem) => {
    setActiveItem(item);
  }, []);

  const askQuestion = useCallback(
    async (question: PrebakedQuestion) => {
      if (!activeItem) return;

      let prompt: string;
      if (activeItem.type === "violation") {
        prompt = buildViolationPrompt(question, activeItem.item, wizardContext);
      } else {
        prompt = buildSuggestionPrompt(
          question,
          activeItem.item,
          wizardContext,
        );
      }

      await sendGovernanceMessage(prompt, GOVERNANCE_SYSTEM_PROMPT);
    },
    [activeItem, wizardContext, sendGovernanceMessage],
  );

  const askStepQuestion = useCallback(
    async (question: PrebakedQuestion) => {
      const prompt = buildStepPrompt(question, currentStepId, wizardContext);
      await sendGovernanceMessage(prompt, GOVERNANCE_SYSTEM_PROMPT);
    },
    [currentStepId, wizardContext, sendGovernanceMessage],
  );

  const getQuestions = useCallback((): PrebakedQuestion[] => {
    if (!activeItem) return [];
    return activeItem.type === "violation"
      ? VIOLATION_QUESTIONS
      : SUGGESTION_QUESTIONS;
  }, [activeItem]);

  return {
    activeItem,
    selectItem,
    askQuestion,
    askStepQuestion,
    getQuestions,
    stepQuestions,
    engineState,
    isStreaming,
  };
}
