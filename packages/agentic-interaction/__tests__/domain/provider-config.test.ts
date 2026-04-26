import assert from "node:assert/strict";
import {
  resolveApiKey,
  resolveFallbackChain,
  createDefaultFallbackChain,
} from "../../src/domain/provider-config.js";
import type {
  CloudProviderEndpoint,
  ProviderFallbackChain,
} from "../../src/domain/provider-config.js";

const testEndpoint: CloudProviderEndpoint = {
  providerId: "openai",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  apiKeyEnvVar: "TEST_RESOLVE_API_KEY",
  temperature: 0.4,
  maxTokens: 4096,
  timeoutMs: 60000,
};

const testChain: ProviderFallbackChain = {
  primary: {
    providerId: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKeyEnvVar: "TEST_PRIMARY_KEY",
    temperature: 0.4,
    maxTokens: 4096,
    timeoutMs: 60000,
  },
  fallbacks: [
    {
      providerId: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-3.5-turbo",
      apiKeyEnvVar: "TEST_FALLBACK_KEY",
      temperature: 0.4,
      maxTokens: 4096,
      timeoutMs: 60000,
    },
  ],
};

(async () => {
  // --- Test 1: resolveApiKey with valid key ---
  {
    const original = process.env.TEST_RESOLVE_API_KEY;
    process.env.TEST_RESOLVE_API_KEY = "sk-test-key";
    try {
      const result = resolveApiKey(testEndpoint);
      assert.ok(result !== null, "Should resolve with valid key");
      assert.strictEqual(result!.apiKey, "sk-test-key");
      assert.strictEqual(result!.providerId, "openai");
      assert.strictEqual(result!.model, "gpt-4o-mini");
      console.log("✅ Test 1: resolveApiKey with valid key - passed");
    } finally {
      if (original !== undefined) process.env.TEST_RESOLVE_API_KEY = original;
      else delete process.env.TEST_RESOLVE_API_KEY;
    }
  }

  // --- Test 2: resolveApiKey with missing key ---
  {
    delete process.env.TEST_RESOLVE_MISSING_KEY;
    const result = resolveApiKey({
      ...testEndpoint,
      apiKeyEnvVar: "TEST_RESOLVE_MISSING_KEY",
    });
    assert.strictEqual(result, null, "Should return null for missing key");
    console.log("✅ Test 2: resolveApiKey with missing key - passed");
  }

  // --- Test 3: resolveApiKey with empty key ---
  {
    process.env.TEST_RESOLVE_EMPTY_KEY = "";
    const result = resolveApiKey({
      ...testEndpoint,
      apiKeyEnvVar: "TEST_RESOLVE_EMPTY_KEY",
    });
    assert.strictEqual(result, null, "Should return null for empty key");
    delete process.env.TEST_RESOLVE_EMPTY_KEY;
    console.log("✅ Test 3: resolveApiKey with empty key - passed");
  }

  // --- Test 4: resolveFallbackChain with both keys ---
  {
    const origPrimary = process.env.TEST_PRIMARY_KEY;
    const origFallback = process.env.TEST_FALLBACK_KEY;
    process.env.TEST_PRIMARY_KEY = "sk-primary";
    process.env.TEST_FALLBACK_KEY = "sk-fallback";
    try {
      const resolved = resolveFallbackChain(testChain);
      assert.strictEqual(resolved.length, 2, "Should resolve both providers");
      assert.strictEqual(resolved[0].apiKey, "sk-primary");
      assert.strictEqual(resolved[1].apiKey, "sk-fallback");
      console.log("✅ Test 4: resolveFallbackChain with both keys - passed");
    } finally {
      if (origPrimary !== undefined) process.env.TEST_PRIMARY_KEY = origPrimary;
      else delete process.env.TEST_PRIMARY_KEY;
      if (origFallback !== undefined)
        process.env.TEST_FALLBACK_KEY = origFallback;
      else delete process.env.TEST_FALLBACK_KEY;
    }
  }

  // --- Test 5: resolveFallbackChain with primary only ---
  {
    const origPrimary = process.env.TEST_PRIMARY_KEY;
    const origFallback = process.env.TEST_FALLBACK_KEY;
    process.env.TEST_PRIMARY_KEY = "sk-primary";
    delete process.env.TEST_FALLBACK_KEY;
    try {
      const resolved = resolveFallbackChain(testChain);
      assert.strictEqual(resolved.length, 1, "Should resolve primary only");
      assert.strictEqual(resolved[0].apiKey, "sk-primary");
      console.log("✅ Test 5: resolveFallbackChain with primary only - passed");
    } finally {
      if (origPrimary !== undefined) process.env.TEST_PRIMARY_KEY = origPrimary;
      else delete process.env.TEST_PRIMARY_KEY;
      if (origFallback !== undefined)
        process.env.TEST_FALLBACK_KEY = origFallback;
      else delete process.env.TEST_FALLBACK_KEY;
    }
  }

  // --- Test 6: resolveFallbackChain with no keys ---
  {
    delete process.env.TEST_PRIMARY_KEY;
    delete process.env.TEST_FALLBACK_KEY;
    const resolved = resolveFallbackChain(testChain);
    assert.strictEqual(resolved.length, 0, "Should resolve no providers");
    console.log("✅ Test 6: resolveFallbackChain with no keys - passed");
  }

  // --- Test 7: createDefaultFallbackChain ---
  {
    const chain = createDefaultFallbackChain();
    assert.strictEqual(chain.primary.providerId, "openai");
    assert.strictEqual(chain.primary.model, "gpt-4o-mini");
    assert.strictEqual(chain.primary.apiKeyEnvVar, "OPENAI_API_KEY");
    assert.strictEqual(chain.fallbacks.length, 1);
    assert.strictEqual(chain.fallbacks[0].model, "gpt-3.5-turbo");
    console.log("✅ Test 7: createDefaultFallbackChain - passed");
  }

  // --- Test 8: createDefaultFallbackChain with custom env var ---
  {
    const chain = createDefaultFallbackChain("MY_CUSTOM_KEY");
    assert.strictEqual(chain.primary.apiKeyEnvVar, "MY_CUSTOM_KEY");
    assert.strictEqual(chain.fallbacks[0].apiKeyEnvVar, "MY_CUSTOM_KEY");
    console.log(
      "✅ Test 8: createDefaultFallbackChain with custom env var - passed",
    );
  }

  console.log("✅ All provider-config tests passed.");
})();
