import type { DomainModelId } from "@hexagen/local-llm";

export type GenerateWithAiScreenState =
  | "idle"
  | "model_selection"
  | "model_downloading"
  | "key_validation"
  | "generating"
  | "clarification_needed"
  | "preview"
  | "error"
  | "interrupted"
  | "unsupported"
  | "wizard_hydration";

export type ModelSelectionEvent =
  | { type: "SELECT_LOCAL_MODEL"; modelId: DomainModelId; remember: boolean }
  | {
      type: "SELECT_CLOUD_PROVIDER";
      provider: string;
      apiKey: string;
      remember: boolean;
    }
  | { type: "SKIP_AI_SETUP" }
  | { type: "CANCEL_DOWNLOAD" }
  | { type: "MODEL_READY" }
  | { type: "MODEL_ERROR"; errorMessage?: string }
  | { type: "API_KEY_VALID" }
  | { type: "API_KEY_INVALID" }
  | { type: "RETRY_GENERATION" }
  | { type: "SAVE_GENERATION_RESULT"; manifest: string }
  | { type: "REJECT_MANIFEST" }
  | { type: "REGENERATE_MANIFEST" }
  | { type: "RESTART_FROM_SELECTION" }
  | { type: "PROCEED_TO_WIZARD" }
  | { type: "REPAIR_MODEL_DOWNLOAD"; modelId: DomainModelId }
  | {
      type: "SET_CLARIFICATION_NEEDED";
      triggers: Array<{ type: string; contextName?: string; message: string }>;
    }
  | { type: "CONFIRM_AND_CONTINUE" }
  | { type: "SET_ERROR"; message: string; errorCode?: string };

function getValidTransitions(
  state: GenerateWithAiScreenState,
): GenerateWithAiScreenState[] {
  switch (state) {
    case "idle":
      return ["model_selection", "generating", "wizard_hydration"];
    case "model_selection":
      return ["model_downloading", "key_validation", "idle"];
    case "model_downloading":
      return ["generating", "error", "interrupted"];
    case "key_validation":
      return ["generating", "error"];
    case "generating":
      return ["clarification_needed", "preview", "error"];
    case "clarification_needed":
      return ["generating", "model_selection"];
    case "preview":
      return ["model_selection", "wizard_hydration"];
    case "error":
      return [
        "model_downloading",
        "key_validation",
        "idle",
        "model_selection",
        "generating",
      ];
    case "interrupted":
      return ["model_selection", "idle"];
    case "unsupported":
      return ["idle", "model_selection", "key_validation"];
    case "wizard_hydration":
      return [];
    default:
      return [];
  }
}

export function canTransition(
  currentState: GenerateWithAiScreenState,
  nextState: GenerateWithAiScreenState,
): boolean {
  return getValidTransitions(currentState).includes(nextState);
}

export function transitionState(
  currentState: GenerateWithAiScreenState,
  event: ModelSelectionEvent,
): GenerateWithAiScreenState {
  switch (event.type) {
    case "SELECT_LOCAL_MODEL":
      return "model_downloading";
    case "SELECT_CLOUD_PROVIDER":
      return "key_validation";
    case "SKIP_AI_SETUP":
      return "idle";
    case "CANCEL_DOWNLOAD":
      return "interrupted";
    case "MODEL_READY":
      return "generating";
    case "MODEL_ERROR":
      return "error";
    case "API_KEY_VALID":
      return "generating";
    case "API_KEY_INVALID":
      return "error";
    case "RETRY_GENERATION":
      return "generating";
    case "SAVE_GENERATION_RESULT":
      return "preview";
    case "REJECT_MANIFEST":
      return "model_selection";
    case "REGENERATE_MANIFEST":
      return "generating";
    case "RESTART_FROM_SELECTION":
      return "model_selection";
    case "PROCEED_TO_WIZARD":
      return "wizard_hydration";
    case "REPAIR_MODEL_DOWNLOAD":
      return "model_downloading";
    case "SET_CLARIFICATION_NEEDED":
      return "clarification_needed";
    case "CONFIRM_AND_CONTINUE":
      return "generating";
    case "SET_ERROR":
      return "error";
    default:
      return currentState;
  }
}

export function getInitialState(): GenerateWithAiScreenState {
  return "idle";
}

export function isTerminalState(state: GenerateWithAiScreenState): boolean {
  return state === "wizard_hydration";
}

export function isBlockingState(state: GenerateWithAiScreenState): boolean {
  return (
    state === "model_downloading" ||
    state === "key_validation" ||
    state === "generating"
  );
}

export interface ModelSelectionStateMachine {
  transition(
    currentState: GenerateWithAiScreenState,
    event: ModelSelectionEvent,
  ): GenerateWithAiScreenState;
  canTransition(
    currentState: GenerateWithAiScreenState,
    nextState: GenerateWithAiScreenState,
  ): boolean;
  getInitialState(): GenerateWithAiScreenState;
  isTerminalState(state: GenerateWithAiScreenState): boolean;
  isBlockingState(state: GenerateWithAiScreenState): boolean;
}

export const modelSelectionMachine: ModelSelectionStateMachine = {
  transition: transitionState,
  canTransition,
  getInitialState,
  isTerminalState,
  isBlockingState,
};
