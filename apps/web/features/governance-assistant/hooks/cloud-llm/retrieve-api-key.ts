import type { UserSecretVaultPort } from "@hexagen/web-driver";

export type RetrieveApiKeyResult =
  | { success: true; apiKey: string }
  | { success: false; message: string };

/**
 * Narrow wrapper around vault.retrieve() that normalizes both
 * "vault not initialized" and vault-error shapes into a single
 * discriminated result.
 *
 * Previously this was 23 LOC inlined at the top of sendMessage.
 */
export async function retrieveApiKey(
  vault: UserSecretVaultPort | null,
): Promise<RetrieveApiKeyResult> {
  if (!vault) {
    return { success: false, message: "Vault not initialized" };
  }

  const keyResult = await vault.retrieve();
  if (!keyResult.success) {
    return {
      success: false,
      message:
        keyResult.error.message || "Failed to retrieve API key from vault",
    };
  }

  return { success: true, apiKey: keyResult.value };
}
