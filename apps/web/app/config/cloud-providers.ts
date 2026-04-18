export interface CloudModelConfig {
  id: string;
  displayName: string;
  contextLength: number;
  available: boolean;
}

export interface CloudProviderConfig {
  id: string;
  displayName: string;
  available: boolean;
  baseUrl: string;
  models: CloudModelConfig[];
}

export const CLOUD_PROVIDERS: CloudProviderConfig[] = [
  {
    id: "openai",
    displayName: "OpenAI",
    available: true,
    baseUrl: "https://api.openai.com/v1",
    models: [
      {
        id: "gpt-4o",
        displayName: "GPT-4o",
        contextLength: 128000,
        available: true,
      },
      {
        id: "gpt-4o-mini",
        displayName: "GPT-4o Mini",
        contextLength: 128000,
        available: true,
      },
      {
        id: "gpt-4-turbo",
        displayName: "GPT-4 Turbo",
        contextLength: 128000,
        available: true,
      },
      {
        id: "gpt-3.5-turbo",
        displayName: "GPT-3.5 Turbo",
        contextLength: 16385,
        available: true,
      },
    ],
  },
  {
    id: "anthropic",
    displayName: "Anthropic",
    available: false,
    baseUrl: "https://api.anthropic.com/v1",
    models: [
      {
        id: "claude-sonnet-4-20250514",
        displayName: "Claude Sonnet 4",
        contextLength: 200000,
        available: false,
      },
      {
        id: "claude-3-5-sonnet-20241022",
        displayName: "Claude 3.5 Sonnet",
        contextLength: 200000,
        available: false,
      },
    ],
  },
  {
    id: "mistral",
    displayName: "Mistral AI",
    available: false,
    baseUrl: "https://api.mistral.ai/v1",
    models: [
      {
        id: "mistral-large-latest",
        displayName: "Mistral Large",
        contextLength: 128000,
        available: false,
      },
    ],
  },
  {
    id: "google",
    displayName: "Google AI",
    available: false,
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: [
      {
        id: "gemini-2.5-flash",
        displayName: "Gemini 2.5 Flash",
        contextLength: 1000000,
        available: false,
      },
    ],
  },
];

export function getCloudProvider(
  providerId: string,
): CloudProviderConfig | undefined {
  return CLOUD_PROVIDERS.find((p) => p.id === providerId);
}

export function getAvailableProviders(): CloudProviderConfig[] {
  return CLOUD_PROVIDERS.filter((p) => p.available);
}

export function getProviderModels(
  providerId: string,
): CloudModelConfig[] | undefined {
  const provider = getCloudProvider(providerId);
  return provider?.models;
}

export type ClientProviderInfo = Omit<CloudProviderConfig, "baseUrl">;

export function getClientProviders(): ClientProviderInfo[] {
  return CLOUD_PROVIDERS.map((provider) => {
    const { baseUrl: _, ...rest } = provider;
    void _;
    return rest;
  });
}
