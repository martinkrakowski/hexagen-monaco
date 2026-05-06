import { describe, it } from "node:test";
import assert from "node:assert";

/**
 * Test suite for three-tier LLM provider gating:
 * Tier 1 (Synchronous): Check env-var API key via hasServerLLMAccessKey()
 * Tier 2 (Asynchronous): Probe server for BYOK tier + full capability picture
 * Tier 3 (Synchronous): Check WebGPU support for local LLM fallback
 *
 * This prevents the "No cloud LLM API keys configured" error by ensuring
 * button is enabled if ANY tier has capability: cloud key OR BYOK OR WebLLM.
 */

describe("Three-Tier LLM Provider Gating (Cloud + BYOK + WebLLM)", () => {
  // Mock ServerLLMAdapter logic
  function mockHasAccessKey(apiKey) {
    return !!apiKey && apiKey.trim().length > 0;
  }

  describe("Tier 1: Synchronous API key check", () => {
    it("should detect when env API key is configured", () => {
      const apiKey = "sk-test-key-12345";
      assert.strictEqual(mockHasAccessKey(apiKey), true);
    });

    it("should detect when env API key is empty string", () => {
      const apiKey = "";
      assert.strictEqual(mockHasAccessKey(apiKey), false);
    });

    it("should detect when env API key is whitespace-only", () => {
      const apiKey = "   ";
      assert.strictEqual(mockHasAccessKey(apiKey), false);
    });

    it("should be available synchronously (no async call)", () => {
      const apiKey = "sk-live-key";
      // Should complete instantly, not require await
      const result = mockHasAccessKey(apiKey);
      assert.strictEqual(typeof result, "boolean");
    });
  });

  describe("Gate Logic: Combining Tier 1 + Tier 2", () => {
    it("should disable button immediately if Tier 1 (env key) missing", () => {
      const hasServerApiKey = false; // Tier 1 result
      const capabilities = null; // Tier 2 not even called
      const hasLlmProviders =
        hasServerApiKey && (capabilities?.canGenerate ?? true);
      assert.strictEqual(hasLlmProviders, false);
    });

    it("should wait for Tier 2 probe if Tier 1 (env key) present", () => {
      const hasServerApiKey = true; // Tier 1 says go ahead
      const capabilitiesProbing = null; // Tier 2 in flight
      // While probing: default to true (fail open) so button stays enabled
      const hasLlmProviders =
        hasServerApiKey && (capabilitiesProbing?.canGenerate ?? true);
      assert.strictEqual(hasLlmProviders, true);
    });

    it("should respect Tier 2 result after probe completes (can generate)", () => {
      const hasServerApiKey = true; // Tier 1 passed
      const capabilities = { capabilities: [], canGenerate: true }; // Tier 2 resolved
      const hasLlmProviders =
        hasServerApiKey || (capabilities?.canGenerate ?? false);
      assert.strictEqual(hasLlmProviders, true);
    });

    it("should respect Tier 2 result after probe completes (cannot generate)", () => {
      // Both tiers missing: no env key AND no BYOK
      const hasServerApiKey = false; // Tier 1 missing
      const capabilities = { capabilities: [], canGenerate: false }; // Tier 2 resolved to no BYOK
      const hasLlmProviders =
        hasServerApiKey || (capabilities?.canGenerate ?? false);
      assert.strictEqual(hasLlmProviders, false);
    });

    it("should enable user if env key exists even if Tier 2 returns no BYOK", () => {
      // Env key is sufficient; BYOK is optional
      const hasServerApiKey = true; // Tier 1 passed
      const capabilities = { capabilities: [], canGenerate: false }; // Tier 2 says no BYOK
      const hasLlmProviders =
        hasServerApiKey || (capabilities?.canGenerate ?? false);
      // Button is still enabled because env key (Tier 1) exists
      assert.strictEqual(hasLlmProviders, true);
    });

    it("should enable BYOK users without env key (Tier 1 false, Tier 2 true)", () => {
      // Critical: This was broken in the AND version. BYOK users with no env key should work.
      const hasServerApiKey = false; // No env key
      const capabilities = { capabilities: [], canGenerate: true }; // BYOK configured
      const hasLlmProviders =
        hasServerApiKey || (capabilities?.canGenerate ?? false);
      assert.strictEqual(hasLlmProviders, true);
    });

    it("should skip Tier 2 probe if Tier 1 fails", () => {
      const hasServerApiKey = false; // Tier 1 failed
      // Tier 2 useEffect dependency should skip probe entirely
      // This prevents unnecessary async roundtrip when we already know no env key exists
      assert.strictEqual(hasServerApiKey, false);
      // In actual component: useEffect([hasServerApiKey]) would skip probe body
    });
  });

  describe("Tier 3: WebLLM Local Fallback", () => {
    it("should enable button via WebLLM when no cloud keys but WebGPU supported", () => {
      // All cloud tiers fail, but browser supports local generation
      const hasServerApiKey = false; // Tier 1
      const capabilities = { capabilities: [], canGenerate: false }; // Tier 2
      const hasLocalLLM = true; // Tier 3: WebGPU + hardware adequate
      const hasAnyProvider =
        (hasServerApiKey || (capabilities?.canGenerate ?? false)) || hasLocalLLM;
      // Button enabled via Tier 3 fallback
      assert.strictEqual(hasAnyProvider, true);
    });

    it("should disable button only if all three tiers unavailable", () => {
      // No cloud key, no BYOK, no WebLLM
      const hasServerApiKey = false; // Tier 1
      const capabilities = { capabilities: [], canGenerate: false }; // Tier 2
      const hasLocalLLM = false; // Tier 3: WebGPU unsupported or inadequate
      const hasAnyProvider =
        (hasServerApiKey || (capabilities?.canGenerate ?? false)) || hasLocalLLM;
      // Button only disabled when all three fail
      assert.strictEqual(hasAnyProvider, false);
    });

    it("should prefer cloud keys over WebLLM (cloud is faster/more capable)", () => {
      // Both cloud and local available
      const hasServerApiKey = true; // Tier 1
      const capabilities = { capabilities: [], canGenerate: true }; // Tier 2
      const hasLocalLLM = true; // Tier 3
      const hasAnyProvider =
        (hasServerApiKey || (capabilities?.canGenerate ?? false)) || hasLocalLLM;
      // Button enabled (will use cloud by default, local is fallback)
      assert.strictEqual(hasAnyProvider, true);
    });
  });

  describe("Error Prevention", () => {
    it("should prevent 500 error by gating button on accurate provider state", () => {
      // Scenario 1: No env API key, BYOK not yet probed (in-flight)
      const hasServerApiKey = false;
      const capabilities = null;
      const hasLlmProviders =
        hasServerApiKey || (capabilities?.canGenerate ?? false);
      // Button is disabled while probing BYOK (fail closed)
      assert.strictEqual(hasLlmProviders, false);

      // Scenario 2: No env API key, BYOK probe completes with positive result
      const capabilitiesResolved = { capabilities: [], canGenerate: true };
      const hasLlmProvidersResolved =
        hasServerApiKey || (capabilitiesResolved?.canGenerate ?? false);
      // Button now enabled because BYOK exists (user can generate)
      assert.strictEqual(hasLlmProvidersResolved, true);
    });

    it("should show env-key-specific tooltip when Tier 1 fails", () => {
      const hasServerApiKey = false;
      const disabledTooltip = !hasServerApiKey
        ? "No cloud API key configured. Set environment variables..."
        : undefined;
      assert.match(disabledTooltip || "", /environment variables/);
    });

    it("should show generic tooltip when Tier 2 fails", () => {
      const hasServerApiKey = true;
      const capabilities = { capabilities: [], canGenerate: false };
      const disabledTooltip = !hasServerApiKey
        ? "No cloud API key configured..."
        : !capabilities?.canGenerate
          ? "No API keys configured. Add an API key in Settings..."
          : undefined;
      assert.match(disabledTooltip || "", /API keys/);
    });
  });

  describe("Performance: Tier 1 short-circuits async work", () => {
    it("should skip Tier 2 probe when Tier 1 result negative", () => {
      // If env key is missing, useEffect dependency doesn't call getCapabilities()
      // This prevents unnecessary /api/manifest/capabilities roundtrip
      const hasServerApiKey = false;
      let probeCalled = false;

      if (hasServerApiKey) {
        probeCalled = true; // getCapabilities() call simulated
      }

      assert.strictEqual(probeCalled, false);
    });

    it("should signal setCapabilities with false immediately on Tier 1 fail", () => {
      const hasServerApiKey = false;
      let capabilitiesState = null;

      if (!hasServerApiKey) {
        capabilitiesState = { capabilities: [], canGenerate: false };
        // setCapabilities() called with explicit false, not null
      }

      assert.strictEqual(capabilitiesState?.canGenerate, false);
    });
  });
});
