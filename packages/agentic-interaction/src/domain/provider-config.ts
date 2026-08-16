export type CloudProviderId =
  | "openai"
  | "anthropic"
  | "mistral"
  | "google"
  | "inception";

export type CloudModelId =
  | "gpt-4o"
  | "gpt-4o-mini"
  | "gpt-4-turbo"
  | "gpt-3.5-turbo"
  | "claude-sonnet-4-20250514"
  | "claude-3-5-sonnet-20241022"
  | "mistral-large-latest"
  | "gemini-2.5-flash"
  | (string & {});

export interface CloudProviderEndpoint {
  providerId: CloudProviderId;
  baseUrl: string;
  model: CloudModelId | string;
  apiKeyEnvVar: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface ProviderFallbackChain {
  primary: CloudProviderEndpoint;
  fallbacks: CloudProviderEndpoint[];
}

export type ResolvedProvider = CloudProviderEndpoint & {
  apiKey: string;
};

/**
 * Port interface for **looking a secret up by name** — a synchronous read of
 * an already-provisioned secret (environment variables, a key-management
 * system, a test double). It does not store, lock, or destroy anything.
 *
 * An absent secret is not an error here: `getSecret` returns `null` and
 * `resolveApiKey` / `resolveFallbackChain` treat that provider as simply not
 * configured. The stored-key contract that *does* raise a typed failure for an
 * absent secret is `ApiKeyVaultLifecyclePort`
 * (`application/ports/out/api-key-vault-lifecycle.port.ts`); the two were once
 * both named `SecretVaultPort` (HEX-008, remediation item 5.4).
 */
export interface SecretVaultPort {
  /**
   * Retrieve API key by environment variable name.
   * @param envVarName Name of the environment variable (e.g., "OPENAI_API_KEY")
   * @returns API key value or null if not found/empty
   */
  getSecret(envVarName: string): string | null;
}

export function resolveApiKey(
  vault: SecretVaultPort,
  endpoint: CloudProviderEndpoint,
): ResolvedProvider | null {
  const apiKey = vault.getSecret(endpoint.apiKeyEnvVar);
  if (!apiKey || apiKey.trim().length === 0) return null;
  return { ...endpoint, apiKey };
}

export function resolveFallbackChain(
  vault: SecretVaultPort,
  chain: ProviderFallbackChain,
): ResolvedProvider[] {
  const candidates = [chain.primary, ...chain.fallbacks];
  const resolved: ResolvedProvider[] = [];
  for (const endpoint of candidates) {
    const r = resolveApiKey(vault, endpoint);
    if (r) resolved.push(r);
  }
  return resolved;
}

// The concrete default chain that used to live here as
// `createDefaultFallbackChain()` moved to
// `infrastructure/adapters/static-provider-catalog.adapter.ts` and is reached
// through `ProviderCatalogPort` (ADR-0051, Decision 1): vendor baseUrls and
// API-key environment-variable names are routing facts, not domain artifacts.
// This module keeps the identities and the resolution rules only.
