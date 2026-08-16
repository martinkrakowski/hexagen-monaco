// Re-export domain types for convenience
export type {
  VaultState,
  VaultStatus,
  VaultError,
} from "../domain/value-objects/index";

// Export ports
export type {
  ApiKeyVaultLifecyclePort,
  ServerLLMRequestPort,
  ServerLLMRequest,
  ServerLLMUserInfo,
  ArchitectureModificationPort,
  ModificationResult,
} from "./ports/index";

// Export use cases
export { GenerateSuggestionUseCase } from "./use-cases/generate-suggestion.use-case";
export { SecureChatDispatchUseCase } from "./use-cases/secure-chat-dispatch.use-case";
export { HandleServerChatUseCase } from "./use-cases/index";
export { ModifyArchitectureUseCase } from "./use-cases/modify-architecture.use-case";
export type { ModifyArchitectureDeps } from "./use-cases/modify-architecture.use-case";
