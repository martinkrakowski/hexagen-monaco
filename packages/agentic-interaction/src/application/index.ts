// Re-export domain types for convenience
export type {
  VaultState,
  VaultStatus,
  VaultError,
} from "../domain/value-objects/index.js";

// Export ports
export type { SecretVaultPort } from "./ports/index.js";

// Export use cases
export { GenerateSuggestionUseCase } from "./use-cases/generate-suggestion.use-case.js";
export { SecureChatDispatchUseCase } from "./use-cases/secure-chat-dispatch.use-case.js";
