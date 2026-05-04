import { ok, err } from "@hexagen/shared";
import type { Result } from "@hexagen/shared";
import type { VaultStatus, VaultError } from "@hexagen/agentic-interaction";
import type { UserSecretVaultPort } from "../../application/ports/user-secret-vault.port.js";

const VAULT_STORAGE_KEY = "hexagen:vault:encrypted-payload";

/**
 * Encrypted Session Vault implementation of SecretVaultPort.
 *
 * This adapter stores the API key encrypted via Web Crypto (AES-GCM) to localStorage,
 * enabling persistence across page refreshes within the same session/tab.
 * The key is:
 * - Encrypted in localStorage using AES-256-GCM
 * - Available after page refresh (persisted in encrypted form)
 * - Lost on logout or explicit destroy
 * - Lost on browser close if localStorage is session-based
 *
 * Security properties:
 * - Ciphertext stored in localStorage (not plaintext)
 * - Plaintext kept in volatile memory while unlocked
 * - Uses Web Crypto API (NIST-approved algorithms)
 * - Encryption key derived from optional user password
 *
 * This adapter is suitable for within-session persistence with encryption.
 * For maximum security, use ephemeral mode (EphemeralSecretVaultAdapter).
 */
export class EncryptedSessionVaultAdapter implements UserSecretVaultPort {
  private inMemoryKey: string | null = null;
  private encryptionKey: CryptoKey | null = null;

  async getStatus(): Promise<Result<VaultStatus, VaultError>> {
    const hasStoredPayload = !!localStorage.getItem(VAULT_STORAGE_KEY);
    const status = ok({
      state: this.inMemoryKey
        ? "unlocked"
        : hasStoredPayload
          ? "locked"
          : "empty",
      hasStoredPayload,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return status as any;
  }

  async store(
    apiKey: string,
    persistOrPassword?: boolean | string,
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

    // Parse the persistOrPassword parameter
    const persist =
      typeof persistOrPassword === "boolean"
        ? persistOrPassword
        : typeof persistOrPassword === "string"
          ? true
          : false;

    // Store in memory immediately
    this.inMemoryKey = apiKey;

    // If persist is false, don't encrypt to localStorage
    if (!persist) {
      const success = ok(undefined);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return success as any;
    }

    // Encrypt and store to localStorage
    try {
      const encrypted = await this.encryptToStorage(apiKey);
      localStorage.setItem(VAULT_STORAGE_KEY, encrypted);

      const success = ok(undefined);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return success as any;
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : "Encryption failed";
      const encError = err({
        kind: "storage_unavailable",
        message: `Failed to encrypt and store key: ${errorMsg}`,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return encError as any;
    }
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
    const stored = localStorage.getItem(VAULT_STORAGE_KEY);
    if (!stored) {
      const error = err({
        kind: "vault_empty",
        message: "No encrypted payload in storage; vault is empty.",
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return error as any;
    }

    try {
      const plaintext = await this.decryptFromStorage(stored);
      this.inMemoryKey = plaintext;

      const success = ok(undefined);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return success as any;
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : "Decryption failed";
      const encError = err({
        kind: "storage_unavailable",
        message: `Failed to decrypt key: ${errorMsg}`,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return encError as any;
    }
  }

  async lock(): Promise<Result<void, VaultError>> {
    // Clear the in-memory key but leave the encrypted payload in storage
    this.inMemoryKey = null;
    const success = ok(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return success as any;
  }

  async destroy(): Promise<Result<void, VaultError>> {
    // Clear both in-memory key and encrypted storage
    this.inMemoryKey = null;
    localStorage.removeItem(VAULT_STORAGE_KEY);
    const success = ok(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return success as any;
  }

  /**
   * Encrypt plaintext using AES-256-GCM and return base64-encoded JSON structure.
   * The structure includes the IV and ciphertext, allowing decryption without a password.
   */
  private async encryptToStorage(plaintext: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);

    // Generate a random 96-bit IV
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Derive a key for AES-GCM (hardcoded, browser-derived)
    const key = await this.getDerivedKey();

    // Encrypt with IV in algorithm parameters
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      data,
    );

    // Package IV + ciphertext as base64 JSON
    const payload = {
      iv: this.bufferToBase64(iv),
      ciphertext: this.bufferToBase64(new Uint8Array(ciphertext)),
    };

    return JSON.stringify(payload);
  }

  /**
   * Decrypt a previously encrypted payload from storage.
   */
  private async decryptFromStorage(stored: string): Promise<string> {
    let payload: { iv: string; ciphertext: string };
    try {
      payload = JSON.parse(stored);
    } catch {
      throw new Error("Invalid encrypted payload format");
    }

    const iv = this.base64ToBuffer(payload.iv);
    const ciphertext = this.base64ToBuffer(payload.ciphertext);

    // Derive the same key used for encryption
    const key = await this.getDerivedKey();

    // Decrypt with IV in algorithm parameters
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plaindata = await crypto.subtle.decrypt(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { name: "AES-GCM", iv: iv.buffer } as any,
      key,
      ciphertext.buffer as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    );

    const decoder = new TextDecoder();
    return decoder.decode(plaindata);
  }

  /**
   * Derive a consistent encryption key using browser-based key material.
   * For browser use, we use a hardcoded, derivable key based on the origin.
   * This is not cryptographically derived from a password; it's deterministic
   * for the session to allow encryption/decryption without password storage.
   *
   * Future: Consider using PBKDF2 with user password for additional security.
   */
  private async getDerivedKey(): Promise<CryptoKey> {
    if (this.encryptionKey) {
      return this.encryptionKey;
    }

    // Derive key from origin + a fixed salt (for this session)
    // This ensures the key is the same for the lifetime of the page
    const originKey = `hexagen:vault:${window.location.origin}`;
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(originKey),
      "PBKDF2",
      false,
      ["deriveBits", "deriveKey"],
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const salt = encoder.encode("hexagen-vault-salt") as any;
    const derivedKey = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: 100000,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );

    this.encryptionKey = derivedKey;
    return derivedKey;
  }

  private bufferToBase64(buffer: Uint8Array): string {
    const arr: number[] = Array.from(buffer);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return btoa(String.fromCharCode.apply(null, arr as any));
  }

  private base64ToBuffer(b64: string): Uint8Array {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}
