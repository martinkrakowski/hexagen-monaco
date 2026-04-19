/**
 * Represents the state of the secret vault.
 *
 * - Empty: No encrypted payload exists in storage; no key in memory
 * - Locked: Encrypted payload exists in storage; no key in memory (requires decryption)
 * - Unlocked: Key is in volatile memory; vault is ready to retrieve API keys
 */
export type VaultState = "empty" | "locked" | "unlocked";

export interface VaultStatus {
  state: VaultState;
  hasStoredPayload: boolean;
}
