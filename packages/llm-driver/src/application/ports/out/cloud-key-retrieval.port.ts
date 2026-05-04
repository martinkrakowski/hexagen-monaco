import type { Result } from "@hexagen/shared";
import type { VaultError } from "@hexagen/agentic-interaction";

/**
 * Port interface for cloud API key retrieval in LLM driver context.
 *
 * This is an outbound port that abstracts the retrieval of API keys
 * from a cloud key store. The concrete implementation is provided
 * by infrastructure adapters at runtime.
 */
export interface CloudKeyRetrievalPort {
  /**
   * Retrieve the stored API key from the cloud key store.
   */
  retrieve(): Promise<Result<string, VaultError>>;
}
