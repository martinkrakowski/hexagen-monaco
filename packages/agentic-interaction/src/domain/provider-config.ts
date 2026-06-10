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
 * Port interface for retrieving secrets from external vault.
 * Abstracts environment variables, key management systems, etc.
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

export function createDefaultFallbackChain(
  primaryEnvVar: string = "OPENAI_API_KEY",
): ProviderFallbackChain {
  return {
    primary: {
      providerId: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKeyEnvVar: primaryEnvVar,
      temperature: 0.4,
      maxTokens: 4096,
      timeoutMs: 60000,
    },
    fallbacks: [
      {
        providerId: "openai",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-3.5-turbo",
        apiKeyEnvVar: primaryEnvVar,
        temperature: 0.4,
        maxTokens: 4096,
        timeoutMs: 60000,
      },
    ],
  };
}
