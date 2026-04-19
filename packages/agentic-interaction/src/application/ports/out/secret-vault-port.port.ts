import type { Result } from "@hexagen/shared";
import type { VaultStatus, VaultError } from "../../../domain/index.js";

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
   * Store a plaintext API key in the vault.
   * For ephemeral: stores in memory only.
   * For encrypted: encrypts and stores with provided password.
   *
   * @param apiKey The plaintext API key to store
   * @param password Optional password (required for encrypted implementations)
   * @returns Result containing void on success or VaultError on failure
   */
  store(apiKey: string, password?: string): Promise<Result<void, VaultError>>;

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
