import type { ProviderFallbackChain } from "../../../domain/provider-config";

/**
 * Outbound port for the vendor provider catalog.
 *
 * ADR-0051 (Decision 1): the `domain/` layer owns provider and model
 * *identities* (`CloudProviderId`, `CloudModelId`, the
 * `ProviderFallbackChain` shape). The *routing* facts — vendor `baseUrl`s,
 * API-key environment-variable names, and the concrete chain assembled from
 * them — are infrastructure, reached through this port and injected by a
 * composition root.
 *
 * Decision 2 ("one catalog builder, per-app composition") is why this returns
 * a chain rather than exposing a table: each app composes the chain it wants
 * at its own root. An app that reads `process.env` at wiring time to build a
 * chain (as `wire.server.ts` does for staged generation) does so in its root
 * and does not need this port at all — the port exists for the *default*,
 * env-independent chain that would otherwise be a literal in `domain/`.
 */
export interface ProviderCatalogPort {
  /**
   * The default cloud chain to use when a caller supplies no explicit one.
   *
   * @param options.primaryApiKeyEnvVar Overrides the environment-variable
   *   name every endpoint in the chain is keyed on. Defaults to the catalog's
   *   own choice.
   */
  createDefaultChain(options?: {
    primaryApiKeyEnvVar?: string;
  }): ProviderFallbackChain;
}
