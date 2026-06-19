import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  resolveApiKey,
  resolveFallbackChain,
  createDefaultFallbackChain,
  type SecretVaultPort,
} from "../../src/domain/provider-config";
import type {
  CloudProviderEndpoint,
  ProviderFallbackChain,
} from "../../src/domain/provider-config";

// Mock vault that reads from process.env
const createEnvVault = (): SecretVaultPort => ({
  getSecret: (envVarName: string) => process.env[envVarName] ?? null,
});

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

describe("provider-config", () => {
  it("should resolve API key with valid key", () => {
    const vault = createEnvVault();
    const original = process.env.TEST_RESOLVE_API_KEY;
    process.env.TEST_RESOLVE_API_KEY = "sk-test-key";
    try {
      const result = resolveApiKey(vault, testEndpoint);
      assert.ok(result !== null, "Should resolve with valid key");
      assert.strictEqual(result!.apiKey, "sk-test-key");
      assert.strictEqual(result!.providerId, "openai");
      assert.strictEqual(result!.model, "gpt-4o-mini");
    } finally {
      if (original !== undefined) process.env.TEST_RESOLVE_API_KEY = original;
      else delete process.env.TEST_RESOLVE_API_KEY;
    }
  });

  it("should return null for missing API key", () => {
    const vault = createEnvVault();
    delete process.env.TEST_RESOLVE_MISSING_KEY;
    const result = resolveApiKey(vault, {
      ...testEndpoint,
      apiKeyEnvVar: "TEST_RESOLVE_MISSING_KEY",
    });
    assert.strictEqual(result, null, "Should return null for missing key");
  });

  it("should return null for empty API key", () => {
    const vault = createEnvVault();
    process.env.TEST_RESOLVE_EMPTY_KEY = "";
    const result = resolveApiKey(vault, {
      ...testEndpoint,
      apiKeyEnvVar: "TEST_RESOLVE_EMPTY_KEY",
    });
    assert.strictEqual(result, null, "Should return null for empty key");
    delete process.env.TEST_RESOLVE_EMPTY_KEY;
  });

  it("should resolve fallback chain with both keys", () => {
    const vault = createEnvVault();
    const origPrimary = process.env.TEST_PRIMARY_KEY;
    const origFallback = process.env.TEST_FALLBACK_KEY;
    process.env.TEST_PRIMARY_KEY = "sk-primary";
    process.env.TEST_FALLBACK_KEY = "sk-fallback";
    try {
      const resolved = resolveFallbackChain(vault, testChain);
      assert.strictEqual(resolved.length, 2, "Should resolve both providers");
      assert.strictEqual(resolved[0].apiKey, "sk-primary");
      assert.strictEqual(resolved[1].apiKey, "sk-fallback");
    } finally {
      if (origPrimary !== undefined) process.env.TEST_PRIMARY_KEY = origPrimary;
      else delete process.env.TEST_PRIMARY_KEY;
      if (origFallback !== undefined)
        process.env.TEST_FALLBACK_KEY = origFallback;
      else delete process.env.TEST_FALLBACK_KEY;
    }
  });

  it("should resolve fallback chain with primary only", () => {
    const vault = createEnvVault();
    const origPrimary = process.env.TEST_PRIMARY_KEY;
    const origFallback = process.env.TEST_FALLBACK_KEY;
    process.env.TEST_PRIMARY_KEY = "sk-primary";
    delete process.env.TEST_FALLBACK_KEY;
    try {
      const resolved = resolveFallbackChain(vault, testChain);
      assert.strictEqual(resolved.length, 1, "Should resolve primary only");
      assert.strictEqual(resolved[0].apiKey, "sk-primary");
    } finally {
      if (origPrimary !== undefined) process.env.TEST_PRIMARY_KEY = origPrimary;
      else delete process.env.TEST_PRIMARY_KEY;
      if (origFallback !== undefined)
        process.env.TEST_FALLBACK_KEY = origFallback;
      else delete process.env.TEST_FALLBACK_KEY;
    }
  });

  it("should resolve no providers when no keys configured", () => {
    const vault = createEnvVault();
    delete process.env.TEST_PRIMARY_KEY;
    delete process.env.TEST_FALLBACK_KEY;
    const resolved = resolveFallbackChain(vault, testChain);
    assert.strictEqual(resolved.length, 0, "Should resolve no providers");
  });

  it("should create default fallback chain", () => {
    const chain = createDefaultFallbackChain();
    assert.strictEqual(chain.primary.providerId, "openai");
    assert.strictEqual(chain.primary.model, "gpt-4o-mini");
    assert.strictEqual(chain.primary.apiKeyEnvVar, "OPENAI_API_KEY");
    assert.strictEqual(chain.fallbacks.length, 1);
    assert.strictEqual(chain.fallbacks[0].model, "gpt-3.5-turbo");
  });

  it("should create default fallback chain with custom env var", () => {
    const chain = createDefaultFallbackChain("MY_CUSTOM_KEY");
    assert.strictEqual(chain.primary.apiKeyEnvVar, "MY_CUSTOM_KEY");
    assert.strictEqual(chain.fallbacks[0].apiKeyEnvVar, "MY_CUSTOM_KEY");
  });
});
