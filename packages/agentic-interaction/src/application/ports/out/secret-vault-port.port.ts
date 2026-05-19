import type { Result } from "@hexagen/shared";
import type { VaultStatus, VaultError } from "../../../domain/index";

/**
 * Port for managing API key storage and retrieval from a secret vault.
 *
 * The vault supports three states:
 * - Empty: No payload stored, no key in memory
 * - Locked: Payload stored but not in memory (requires decryption/unlock)
 * - Unlocked: Key is in volatile memory, ready to use
 */
export interface SecretVaultPort {
  /**
   * Get the current vault state without modifying it.
   */
  getStatus(): Promise<Result<VaultStatus, VaultError>>;

  /**
   * Store a plaintext API key in the vault with optional persistence strategy.
   *
   * Storage behavior is determined by the persist flag:
   * - persist: false (Ephemeral): Key stored strictly in transient memory only.
   *   Lost on page refresh, tab close, or logout.
   * - persist: true (Encrypted Storage): Key encrypted via Web Crypto (AES-GCM)
   *   and persisted to localStorage. Survives page refresh but is cleared on logout.
   *
   * For encrypted implementations, a password may be required for encryption.
   *
   * @param apiKey The plaintext API key to store
   * @param persistOrPassword Either a boolean persist flag (preferred) or legacy password string for backward compatibility
   * @param password Optional password for encryption (required if persist=true for some adapters)
   * @returns Result containing void on success or VaultError on failure
   */
  store(
    apiKey: string,
    persistOrPassword?: boolean | string,
    password?: string,
  ): Promise<Result<void, VaultError>>;

  /**
   * Retrieve the plaintext API key from the vault.
   * Requires vault to be in "unlocked" state.
   *
   * @returns Result containing the plaintext API key or VaultError
   */
  retrieve(): Promise<Result<string, VaultError>>;

  /**
   * Unlock a locked vault using the provided password.
   * For ephemeral: no-op (always unlocked if key is present).
   * For encrypted: decrypts stored payload and loads into memory.
   *
   * @param password The password to decrypt the vault
   * @returns Result containing void on success or VaultError on failure
   */
  unlock(password: string): Promise<Result<void, VaultError>>;

  /**
   * Lock the vault, purging the key from memory.
   * Does not delete the stored encrypted payload.
   * For ephemeral: clears the in-memory key.
   * For encrypted: removes plaintext from memory but leaves encrypted storage intact.
   *
   * @returns Result containing void on success or VaultError on failure
   */
  lock(): Promise<Result<void, VaultError>>;

  /**
   * Destroy the vault completely.
   * For ephemeral: clears in-memory key.
   * For encrypted: deletes the encrypted payload from storage and clears memory.
   *
   * @returns Result containing void on success or VaultError on failure
   */
  destroy(): Promise<Result<void, VaultError>>;
}
