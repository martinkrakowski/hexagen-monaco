import type { Result } from "@hexagen/shared";
import type { VaultStatus, VaultError } from "@hexagen/agentic-interaction";

/**
 * Port interface for user API key vault (browser-side).
 * This is distinct from SecretVaultPort in agentic-interaction,
 * which is for server-side environment variable access.
 *
 * This port manages user-provided API keys in the browser with
 * support for encryption, persistence, and session management.
 */
export interface UserSecretVaultPort {
  /**
   * Get the current status of the vault (empty, locked, or unlocked).
   */
  getStatus(): Promise<Result<VaultStatus, VaultError>>;

  /**
   * Store an API key in the vault.
   * @param apiKey The API key to store
   * @param persistOrPassword Optional: true to persist, false for memory-only, or password string for encryption
   */
  store(
    apiKey: string,
    persistOrPassword?: boolean | string,
  ): Promise<Result<void, VaultError>>;

  /**
   * Retrieve the stored API key (vault must be unlocked).
   */
  retrieve(): Promise<Result<string, VaultError>>;

  /**
   * Unlock the vault (decrypt from storage if applicable).
   */
  unlock(): Promise<Result<void, VaultError>>;

  /**
   * Lock the vault (clear from memory but keep encrypted in storage).
   */
  lock(): Promise<Result<void, VaultError>>;

  /**
   * Destroy the vault (clear from memory and storage).
   */
  destroy(): Promise<Result<void, VaultError>>;
}

// Made with Bob
