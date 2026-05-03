import { ok, err } from "@hexagen/shared";
import type { Result } from "@hexagen/shared";
import type { VaultStatus, VaultError } from "@hexagen/agentic-interaction";
import type { UserSecretVaultPort } from "../../application/ports/user-secret-vault.port.js";

/**
 * Ephemeral (in-memory only) implementation of the UserSecretVaultPort.
 *
 * This adapter stores the API key solely in volatile application memory.
 * The key is:
 * - Lost on page refresh
 * - Lost on tab close
 * - Lost on logout
 *
 * Security properties:
 * - Plaintext in memory (not encrypted)
 * - Never written to localStorage or IndexedDB
 * - Cleared by garbage collection when this adapter instance is disposed
 *
 * This adapter is suitable for ephemeral trust models but does not persist
 * across sessions. For session persistence, use EncryptedSessionVaultAdapter.
 */
export class EphemeralSecretVaultAdapter implements UserSecretVaultPort {
  private inMemoryKey: string | null = null;

  async getStatus(): Promise<Result<VaultStatus, VaultError>> {
    // Type casting needed due to Result generic variance issue
    const status = ok({
      state: this.inMemoryKey ? "unlocked" : "empty",
      hasStoredPayload: false,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return status as any;
  }

  async store(
    apiKey: string,
    _persistOrPassword?: boolean | string,
  ): Promise<Result<void, VaultError>> {
    // Validate the key is not empty
    if (!apiKey || apiKey.trim().length === 0) {
      const error = err({
        kind: "invalid_key",
        message: "API key cannot be empty",
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return error as any;
    }

    // For ephemeral adapter, persist flag is ignored; always store in memory only
    // The persist flag would be respected by EncryptedSessionVaultAdapter
    // (persistOrPassword is either a boolean persist flag or legacy password string)
    this.inMemoryKey = apiKey;

    const success = ok(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return success as any;
  }

  async retrieve(): Promise<Result<string, VaultError>> {
    if (!this.inMemoryKey) {
      const error = err({
        kind: "vault_empty",
        message:
          "No API key in memory; vault is empty. Please store a key first.",
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return error as any;
    }

    const success = ok(this.inMemoryKey);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return success as any;
  }

  async unlock(): Promise<Result<void, VaultError>> {
    // Ephemeral vault has no locked state; this is a no-op
    const success = ok(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return success as any;
  }

  async lock(): Promise<Result<void, VaultError>> {
    // Clear the in-memory key
    this.inMemoryKey = null;
    const success = ok(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return success as any;
  }

  async destroy(): Promise<Result<void, VaultError>> {
    // Same as lock for ephemeral implementation
    this.inMemoryKey = null;
    const success = ok(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return success as any;
  }
}
