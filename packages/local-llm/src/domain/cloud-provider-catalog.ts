/**
 * Registry of supported cloud LLM providers and their models.
 *
 * Provenance: hand-maintained. Values sourced from each vendor's
 * public API documentation. When a vendor releases a new model or
 * deprecates one, this file is the single point of update.
 *
 * LAYERING (ADR-0051, Decision 1) — this file carries provider and model
 * *identities* only. Vendor routing data (`baseUrl`) is an infrastructure
 * concern and lives in
 * `src/infrastructure/adapters/cloud-provider-routing.ts`; it is therefore
 * absent from the `@hexagen/local-llm/client` subpath, which re-exports this
 * module into the browser bundle.
 */

export type CloudProviderId = "openai" | "anthropic" | "mistral" | "google";

export type CloudModelId =
  // OpenAI
  | "gpt-4o"
  | "gpt-4o-mini"
  | "gpt-4-turbo"
  | "gpt-3.5-turbo"
  // Anthropic
  | "claude-sonnet-4-20250514"
  | "claude-3-5-sonnet-20241022"
  // Mistral
  | "mistral-large-latest"
  // Google
  | "gemini-2.5-flash";

export interface CloudModelConfig {
  id: CloudModelId;
  displayName: string;
  contextLength: number;
  /**
   * Whether this specific model is currently exposed. A model can be
   * marked unavailable even if the parent provider is available
   * (e.g. during a rollout). If the parent provider is unavailable,
   * every model beneath it should also be unavailable — this is a
   * convention, not a compiler-enforced invariant.
   */
  available: boolean;
}

export interface CloudProviderConfig {
  id: CloudProviderId;
  displayName: string;
  /** Whether the provider is exposed to users at all. */
  available: boolean;
  models: CloudModelConfig[];
}

export const CLOUD_PROVIDERS: readonly CloudProviderConfig[] = [
  {
    id: "openai",
    displayName: "OpenAI",
    available: true,
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

/** Lookup a provider by id. Returns undefined for unknown ids. */
export function getCloudProvider(
  providerId: string,
): CloudProviderConfig | undefined {
  return CLOUD_PROVIDERS.find((p) => p.id === providerId);
}

/** Providers currently exposed to users. */
export function getAvailableProviders(): readonly CloudProviderConfig[] {
  return CLOUD_PROVIDERS.filter((p) => p.available);
}

/** Models for a given provider, or undefined if the provider is unknown. */
export function getProviderModels(
  providerId: string,
): readonly CloudModelConfig[] | undefined {
  return getCloudProvider(providerId)?.models;
}

/**
 * Safe-to-serialize projection of a provider.
 *
 * Historically this stripped the server-only `baseUrl`; since ADR-0051 moved
 * vendor routing to infrastructure there is nothing left to strip, so the
 * projection is structurally identical to the catalog entry. The name and the
 * explicit field list are kept: they are the contract the settings views
 * consume, and they keep the "what may cross to the client" decision written
 * down at the boundary rather than implied by the catalog's shape.
 */
export type ClientProviderInfo = CloudProviderConfig;

/**
 * Provider list in its client-safe projection. Fields are enumerated rather
 * than spread so that adding a server-only field to `CloudProviderConfig`
 * cannot leak it to the browser by default.
 */
export function getClientProviders(): ClientProviderInfo[] {
  return CLOUD_PROVIDERS.map(
    ({ id, displayName, available, models }): ClientProviderInfo => ({
      id,
      displayName,
      available,
      models,
    }),
  );
}
