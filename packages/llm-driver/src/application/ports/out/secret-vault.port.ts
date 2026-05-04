import type { Result } from "@hexagen/shared";
import type { VaultError } from "@hexagen/agentic-interaction";

/**
 * Port interface for secret vault access in LLM driver context.
 *
 * This is an outbound port that abstracts the underlying vault implementation.
 * The concrete implementation (e.g., browser-based encryption) is provided
 * by infrastructure adapters at runtime.
 */
export interface SecretVaultPort {
  /**
   * Retrieve the stored API key from the vault.
   */
  retrieve(): Promise<Result<string, VaultError>>;
}
