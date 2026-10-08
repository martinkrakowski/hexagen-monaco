import type {
  MigrationStep,
  MigrationResult,
} from "./migration-orchestrator.js";

const BYOK_KEYS_STORAGE_KEY = "byok:keys"; // belongs to removed LocalStorageByokStoreAdapter
const ENCRYPTED_VAULT_STORAGE_KEY = "hexagen:vault:encrypted-payload"; // belongs to removed EncryptedSessionVaultAdapter

/**
 * Removes the two localStorage keys left behind by the deleted browser secret
 * stores (EncryptedSessionVaultAdapter and LocalStorageByokStoreAdapter).
 *
 * Nothing reads these keys now. They are deleted once, on the client, the first
 * time the app starts after the adapters were removed. A localStorage that
 * throws (e.g. privacy mode) returns success: false with a message so the
 * orchestrator retries on the next start — the step never rethrows.
 *
 * ID-tracked via MigrationOrchestrator step.id; skips if already run.
 */
export class RemoveUnusedSecretKeysStep implements MigrationStep {
  id = "remove-unused-secret-keys";
  description =
    "Delete localStorage keys for the removed EncryptedSessionVaultAdapter and LocalStorageByokStoreAdapter";

  async migrate(): Promise<MigrationResult> {
    if (typeof window === "undefined") {
      return { success: true, recordsMigrated: 0, errors: [] };
    }

    let recordsMigrated = 0;
    let threw = false;
    let message = "";

    try {
      if (localStorage.getItem(BYOK_KEYS_STORAGE_KEY) !== null) {
        recordsMigrated += 1;
      }
      localStorage.removeItem(BYOK_KEYS_STORAGE_KEY);

      if (localStorage.getItem(ENCRYPTED_VAULT_STORAGE_KEY) !== null) {
        recordsMigrated += 1;
      }
      localStorage.removeItem(ENCRYPTED_VAULT_STORAGE_KEY);
    } catch (e) {
      threw = true;
      message =
        e instanceof Error ? e.message : "Failed to remove unused secret keys";
    }

    if (threw) {
      // Leave the step incomplete so the orchestrator retries next start.
      return {
        success: false,
        recordsMigrated: 0,
        errors: [message],
      };
    }

    return { success: true, recordsMigrated, errors: [] };
  }

  async verify(): Promise<boolean> {
    if (typeof window === "undefined") return true;

    try {
      if (localStorage.getItem(BYOK_KEYS_STORAGE_KEY) !== null) return false;
      if (localStorage.getItem(ENCRYPTED_VAULT_STORAGE_KEY) !== null) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }
}
