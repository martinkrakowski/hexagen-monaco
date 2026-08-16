/**
 * Pins for the infrastructure provider catalog (ADR-0051, Decision 1).
 *
 * This adapter is the new home of the chain that used to be
 * `createDefaultFallbackChain()` in `domain/provider-config.ts`. The first
 * case below is a byte-for-byte pin of that chain: the migration is a *move*,
 * and a move that changes an endpoint, a model or a sampling parameter is a
 * behaviour change wearing a refactor's clothes.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { ProviderFallbackChain } from "../../src/domain/provider-config";
import { resolveFallbackChain } from "../../src/domain/provider-config";
import { StaticProviderCatalogAdapter } from "../../src/infrastructure/adapters/static-provider-catalog.adapter";

/**
 * Exactly what `createDefaultFallbackChain()` returned before it was deleted
 * (packages/agentic-interaction/src/domain/provider-config.ts:73-98 @ 00e6e748).
 */
const PRE_MIGRATION_DEFAULT_CHAIN: ProviderFallbackChain = {
  primary: {
    providerId: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKeyEnvVar: "OPENAI_API_KEY",
    temperature: 0.4,
    maxTokens: 4096,
    timeoutMs: 60000,
  },
  fallbacks: [
    {
      providerId: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-3.5-turbo",
      apiKeyEnvVar: "OPENAI_API_KEY",
      temperature: 0.4,
      maxTokens: 4096,
      timeoutMs: 60000,
    },
  ],
};

describe("StaticProviderCatalogAdapter", () => {
  it("returns the pre-migration default chain, field for field", () => {
    const catalog = new StaticProviderCatalogAdapter();
    assert.deepEqual(catalog.createDefaultChain(), PRE_MIGRATION_DEFAULT_CHAIN);
  });

  it("re-keys every endpoint when a primary env var is supplied", () => {
    const catalog = new StaticProviderCatalogAdapter();
    const chain = catalog.createDefaultChain({
      primaryApiKeyEnvVar: "MY_CUSTOM_KEY",
    });

    assert.strictEqual(chain.primary.apiKeyEnvVar, "MY_CUSTOM_KEY");
    // The fallback must be re-keyed too — the deleted domain helper applied
    // its `primaryEnvVar` argument to both entries, and a catalog that
    // re-keyed only the primary would silently strand the fallback.
    assert.strictEqual(chain.fallbacks[0]!.apiKeyEnvVar, "MY_CUSTOM_KEY");
    // Everything else is untouched by the override.
    assert.strictEqual(chain.primary.model, "gpt-4o-mini");
    assert.strictEqual(chain.fallbacks[0]!.model, "gpt-3.5-turbo");
  });

  it("hands back an independently mutable chain on every call", () => {
    // `createDefaultFallbackChain` built a fresh object literal per call.
    // A catalog that returned a shared frozen/singleton chain would let one
    // caller's mutation leak into the next request's wiring.
    const catalog = new StaticProviderCatalogAdapter();
    const first = catalog.createDefaultChain();
    const second = catalog.createDefaultChain();

    assert.notStrictEqual(first, second);
    assert.notStrictEqual(first.fallbacks, second.fallbacks);
    first.primary.model = "mutated";
    assert.strictEqual(second.primary.model, "gpt-4o-mini");
  });

  it("reads no environment: the chain is identical with the LLM_* vars set", () => {
    // Guards the ADR-0051 Decision 3 boundary from the other side — this
    // catalog must never grow into a second env-derived chain builder. Only
    // wire.server's buildStagedGenerationFallbackChain reads process.env.
    const saved = {
      LLM_BASE_URL: process.env.LLM_BASE_URL,
      LLM_MODEL: process.env.LLM_MODEL,
      INCEPTION_MODEL: process.env.INCEPTION_MODEL,
    };
    try {
      process.env.LLM_BASE_URL = "https://should-be-ignored.example/v1";
      process.env.LLM_MODEL = "should-be-ignored";
      process.env.INCEPTION_MODEL = "should-be-ignored";

      const catalog = new StaticProviderCatalogAdapter();
      assert.deepEqual(
        catalog.createDefaultChain(),
        PRE_MIGRATION_DEFAULT_CHAIN,
      );
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("produces a chain the domain resolver can consume end to end", () => {
    // The catalog output must stay a valid `ProviderFallbackChain` for
    // `resolveFallbackChain` — the actual consumer downstream of the wire.
    const catalog = new StaticProviderCatalogAdapter();
    const resolved = resolveFallbackChain(
      { getSecret: (name) => (name === "OPENAI_API_KEY" ? "sk-test" : null) },
      catalog.createDefaultChain(),
    );

    assert.deepEqual(
      resolved.map((p) => [p.model, p.baseUrl, p.apiKey]),
      [
        ["gpt-4o-mini", "https://api.openai.com/v1", "sk-test"],
        ["gpt-3.5-turbo", "https://api.openai.com/v1", "sk-test"],
      ],
    );
  });
});
