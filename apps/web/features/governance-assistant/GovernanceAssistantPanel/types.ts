import type {
  Violation,
  AISuggestion,
  PrebakedQuestion,
} from "@hexagen/prompt-compiler";
import type {
  LLMEngineState,
  DomainModelId,
  ModelMetadata,
} from "@hexagen/local-llm";
import type { CloudChatMessage } from "../hooks/useCloudLlm";
import type { ConnectionState } from "../hooks/useCloudConnection";

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
  cloudConnectionState: ConnectionState;
  cloudConnectionError: { message: string; retryable: boolean } | null;
  onCloudConnect: (provider: string, model: string) => Promise<void>;
  onCloudDisconnect: () => void;
  onRetryConnection: () => void;
  cloudMessages: CloudChatMessage[];
  cloudLLMStatus: string;
  cloudLLMError: string | null;
  onSendMessage: (content: string) => void;
  onAbort: () => void;
  onClear: () => void;
  modelName: string;
  llmEngineState: LLMEngineState;
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
  loadedModel: ModelMetadata | null;
  messagesLength: number;
  onSwitchModel: (modelId: DomainModelId) => Promise<void>;
  onDeleteModel: (modelId: DomainModelId) => Promise<void>;
  hasModelInCache: (modelId: DomainModelId) => Promise<boolean>;
  onInitModel: () => void;
  onResetConfig?: () => void;
}
