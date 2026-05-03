import type {
  Violation,
  AISuggestion,
  PrebakedQuestion,
} from "@hexagen/prompt-compiler";

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

export interface ModeWrapperProps {
  mode: LLMMode;
  panelView: PanelView;
  onModeChange: (mode: LLMMode) => void;
  cloudConnectionState: "disconnected" | "connecting" | "connected";
  cloudConnectionError: { message: string; retryable: boolean } | null;
  onCloudConnect: (provider: string, model: string) => Promise<void>;
  onCloudDisconnect: () => void;
  onRetryConnection: () => void;
  cloudMessages: Array<{ role: "user" | "assistant"; content: string }>;
  cloudLLMStatus: string;
  cloudLLMError: string | null;
  onSendMessage: (content: string) => void;
  onAbort: () => void;
  onClear: () => void;
  modelName: string;
  llmEngineState: {
    status: string;
    progress: number;
    errorMessage: string | null;
    autoLoading: boolean;
    loadedModelId?: string;
  };
  showBootSpinner: boolean;
  showUnavailable: boolean;
  showWakingUp: boolean;
  showProgress: boolean;
  showError: boolean;
  showRequiresModel: boolean;
  onRefresh: () => void;
  isLoading: boolean;
  onCancelDownload: () => void;
  onOpenSettings: () => void;
  onBackFromSettings: () => void;
  onSwitchToCloud: () => void;
  loadedModel: unknown;
  messagesLength: number;
  onSwitchModel: (modelId: unknown) => Promise<void>;
  onDeleteModel: (modelId: unknown) => Promise<void>;
  hasModelInCache: (modelId: unknown) => Promise<boolean>;
  onInitModel: () => void;
}
