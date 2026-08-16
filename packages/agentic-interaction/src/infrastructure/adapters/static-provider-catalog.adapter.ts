import type { ProviderCatalogPort } from "../../application/ports/out/provider-catalog.port";
import type { ProviderFallbackChain } from "../../domain/provider-config";

/**
 * Infrastructure catalog holding the vendor routing facts for the default
 * cloud chain: endpoint URLs, model ids and the API-key environment-variable
 * name.
 *
 * ADR-0051 (Decision 1) moved these out of `domain/provider-config.ts`, where
 * they lived as `createDefaultFallbackChain()`. Rotating an endpoint or
 * renaming a secret variable is an edit to this file — not to a domain module.
 *
 * "Static" is literal: unlike `wire.server.ts`'s
 * `buildStagedGenerationFallbackChain`, this reads no environment at all. The
 * env-derived staged chain is a composition-root responsibility that ADR-0051
 * (Decision 3) deliberately leaves where it is; this catalog is the
 * env-independent default the two are often confused for. They are distinct
 * chains with distinct models (`gpt-4o` vs `gpt-4o-mini`).
 */
export class StaticProviderCatalogAdapter implements ProviderCatalogPort {
  private static readonly DEFAULT_API_KEY_ENV_VAR = "OPENAI_API_KEY";

  createDefaultChain(
    options: { primaryApiKeyEnvVar?: string } = {},
  ): ProviderFallbackChain {
    const apiKeyEnvVar =
      options.primaryApiKeyEnvVar ??
      StaticProviderCatalogAdapter.DEFAULT_API_KEY_ENV_VAR;

    return {
      primary: {
        providerId: "openai",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        apiKeyEnvVar,
        temperature: 0.4,
        maxTokens: 4096,
        timeoutMs: 60000,
      },
      fallbacks: [
        {
          providerId: "openai",
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-3.5-turbo",
          apiKeyEnvVar,
          temperature: 0.4,
          maxTokens: 4096,
          timeoutMs: 60000,
        },
      ],
    };
  }
}
