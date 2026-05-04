import { useRef, useCallback } from "react";
import { getModelPreferences } from "../../ModelSelectionFlow/modelPreferencesStorage";
import type { LocalLLMContext } from "../../../../lib/llm-interfaces";
import type {
  WelcomeFlowState,
  WelcomeFlowActions,
} from "../../ModelSelectionFlow/useWelcomeFlowState";
import type { ClientManifestGenerationResult } from "../types";

export interface NavigationHandlers {
  handleGenerate: (isValid: boolean) => void;
  handleUseExample: (example: string, index: number) => void;
  handleRegenerate: () => void;
  handleRetryFromError: () => void;
  handleConfirmAndContinue: () => void;
  rememberChoice: boolean;
  setRememberChoice: (value: boolean) => void;
}

export function useWelcomeScreenNavigation(
  llmContext: LocalLLMContext,
  flowState: WelcomeFlowState,
  actions: WelcomeFlowActions,
  onSetDescription: (desc: string) => void,
  onSetSelectedExample: (idx: number | null) => void,
  clientGen: ClientManifestGenerationResult,
) {
  const rememberChoiceRef = useRef(false);
  const clientGenAbortRef = useRef<AbortController | null>(null);

  const handleGenerate = useCallback(
    (isValid: boolean) => {
      if (!isValid) return;
      const prefs = getModelPreferences();
      if (
        llmContext.engineState.status === "ready" ||
        (prefs.rememberChoice && prefs.lastModelId)
      ) {
        actions.transitionTo("generating");
      } else {
        actions.transitionTo("model_selection");
      }
    },
    [llmContext.engineState.status, actions],
  );

  const handleUseExample = useCallback(
    (example: string, index: number) => {
      onSetDescription(example);
      onSetSelectedExample(index);
    },
    [onSetDescription, onSetSelectedExample],
  );

  const handleRegenerate = useCallback(() => {
    if (clientGenAbortRef.current) {
      clientGenAbortRef.current.abort();
      clientGenAbortRef.current = null;
    }
    clientGen.reset();
    actions.regenerateManifest();
  }, [clientGen, actions]);

  const handleRetryFromError = useCallback(() => {
    if (clientGenAbortRef.current) {
      clientGenAbortRef.current.abort();
      clientGenAbortRef.current = null;
    }
    clientGen.reset();
    actions.regenerateManifest();
  }, [clientGen, actions]);

  const handleConfirmAndContinue = useCallback(() => {
    actions.confirmAndContinue();
  }, [actions]);

  return {
    handleGenerate,
    handleUseExample,
    handleRegenerate,
    handleRetryFromError,
    handleConfirmAndContinue,
    rememberChoiceRef,
    clientGenAbortRef,
  };
}
