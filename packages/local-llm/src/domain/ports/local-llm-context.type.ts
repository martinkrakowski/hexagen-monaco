import type { LLMEngineState } from "../value-objects/llm-engine-state.vo.js";
import type { DomainModelId } from "../value-objects/model-id.vo.js";
import type { ModelMetadata } from "../value-objects/index.js";
import type { LLMRequest } from "../value-objects/llm-request.vo.js";
import type { LLMMessage } from "./local-llm-provider.port.js";

export type LocalLLMContext = {
  engineState: LLMEngineState;
  initializeModel: (modelId: DomainModelId) => Promise<void>;
  cancelDownload: () => void;
  hasAnyCachedModel: () => Promise<boolean>;
  hasModelInCache: (modelId: DomainModelId) => Promise<boolean>;
  // Phase 3 additions
  switchModel: (modelId: DomainModelId) => Promise<void>;
  deleteCachedModel: (modelId: DomainModelId) => Promise<void>;
  loadedModel: ModelMetadata | null;
  sendGovernanceMessage: (
    content: string,
    systemPrompt: string,
    history?: LLMRequest["messages"],
  ) => Promise<void>;
  // NEW - dedicated method for structured generation, returns content directly
  sendStructuredPrompt: (
    userPrompt: string,
    systemPrompt: string,
    signal?: AbortSignal,
  ) => Promise<string>;
  messages: LLMMessage[];
};
