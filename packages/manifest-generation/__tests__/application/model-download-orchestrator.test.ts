import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createModelDownloadOrchestrator } from "../../src/application/use-cases/model-download-orchestrator.use-case";

type DomainModelId =
  | "qwen-coder-3b"
  | "llama-3.2-3b"
  | "qwen3-8b"
  | "qwen3-4b"
  | "qwen3-1.7b"
  | "qwen3-0.6b"
  | "qwen-coder-1.5b"
  | "llama-3.2-1b"
  | "qwen-coder-0.5b";

const QWEN_CODER_3B: DomainModelId = "qwen-coder-3b";

describe("ModelDownloadOrchestrator", () => {
  const mockPreferencesPort = {
    getPreferences: () => ({
      hasEnabledLocalModels: false,
      lastModelId: null,
      autoLoadEnabled: false,
      cloudProvider: null,
      rememberApiKey: false,
      skipAiSetup: false,
      rememberChoice: false,
    }),
    setPreferences: () => {},
  };

  const mockVerificationPort = {
    isModelVerified: () => false,
    updateModelCacheMetadata: () => {},
    clearModelCacheMetadata: () => {},
  };

  let orchestrator: ReturnType<typeof createModelDownloadOrchestrator>;

  beforeEach(() => {
    orchestrator = createModelDownloadOrchestrator({
      preferencesPort: mockPreferencesPort,
      verificationPort: mockVerificationPort,
    });
  });

  describe("selectLocalModel", () => {
    it("should return success with model_downloading state", () => {
      const result = orchestrator.selectLocalModel({
        modelId: QWEN_CODER_3B,
        remember: false,
      });
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.nextState, "model_downloading");
    });

    it("should save preferences when remember is true", () => {
      let savedPreferences: any = {};
      const portWithSpy = {
        ...mockPreferencesPort,
        setPreferences: (prefs: any) => {
          savedPreferences = prefs;
        },
      };

      const orch = createModelDownloadOrchestrator({
        preferencesPort: portWithSpy,
        verificationPort: mockVerificationPort,
      });

      orch.selectLocalModel({ modelId: QWEN_CODER_3B, remember: true });

      assert.strictEqual(savedPreferences.lastModelId, QWEN_CODER_3B);
      assert.strictEqual(savedPreferences.autoLoadEnabled, true);
      assert.strictEqual(savedPreferences.hasEnabledLocalModels, true);
      assert.strictEqual(savedPreferences.rememberChoice, true);
    });
  });

  describe("cancelDownload", () => {
    it("should return interrupted state and update preferences", () => {
      let clearedPreferences = false;
      const portWithSpy = {
        ...mockPreferencesPort,
        setPreferences: (prefs: any) => {
          if (
            prefs.autoLoadEnabled === false &&
            prefs.rememberChoice === false
          ) {
            clearedPreferences = true;
          }
        },
      };

      const orch = createModelDownloadOrchestrator({
        preferencesPort: portWithSpy,
        verificationPort: mockVerificationPort,
      });

      const result = orch.cancelDownload();
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.nextState, "interrupted");
      assert.strictEqual(clearedPreferences, true);
    });
  });

  describe("selectCloudProvider", () => {
    it("should validate API key format for openai", () => {
      const result = orchestrator.selectCloudProvider({
        provider: "openai",
        apiKey: "invalid-key",
        remember: false,
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.nextState, "error");
      assert.strictEqual(result.errorCode, "key_invalid_format");
    });

    it("should validate API key format for anthropic", () => {
      const result = orchestrator.selectCloudProvider({
        provider: "anthropic",
        apiKey: "invalid-key",
        remember: false,
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.nextState, "error");
      assert.strictEqual(result.errorCode, "key_invalid_format");
    });

    it("should accept valid openai key", () => {
      const result = orchestrator.selectCloudProvider({
        provider: "openai",
        apiKey: "sk-test123456",
        remember: false,
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.nextState, "generating");
    });

    it("should accept valid anthropic key", () => {
      const result = orchestrator.selectCloudProvider({
        provider: "anthropic",
        apiKey: "sk-ant-test123456",
        remember: false,
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.nextState, "generating");
    });
  });

  describe("skipAiSetup", () => {
    it("should return idle state and save preference", () => {
      let savedPrefs = false;
      const portWithSpy = {
        ...mockPreferencesPort,
        setPreferences: (prefs: any) => {
          if (prefs.skipAiSetup === true) savedPrefs = true;
        },
      };

      const orch = createModelDownloadOrchestrator({
        preferencesPort: portWithSpy,
        verificationPort: mockVerificationPort,
      });

      const result = orch.skipAiSetup();
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.nextState, "idle");
      assert.strictEqual(savedPrefs, true);
    });
  });

  describe("markModelReady", () => {
    it("should update verification metadata", () => {
      let updatedMetadata: any = {};
      const portWithSpy = {
        ...mockVerificationPort,
        updateModelCacheMetadata: (modelId: string, updates: any) => {
          updatedMetadata = { modelId, updates };
        },
      };

      const orch = createModelDownloadOrchestrator({
        preferencesPort: mockPreferencesPort,
        verificationPort: portWithSpy,
      });

      const result = orch.markModelReady(QWEN_CODER_3B);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.nextState, "generating");
      assert.strictEqual(updatedMetadata.modelId, QWEN_CODER_3B);
      assert.ok(updatedMetadata.updates.verifiedAt != null);
      assert.strictEqual(updatedMetadata.updates.downloadCompleted, true);
    });
  });

  describe("repairModelDownload", () => {
    it("should clear cache metadata and return downloading state", () => {
      let clearedModelId: string | null = null;
      const portWithSpy = {
        ...mockVerificationPort,
        clearModelCacheMetadata: (modelId: string) => {
          clearedModelId = modelId;
        },
      };

      const orch = createModelDownloadOrchestrator({
        preferencesPort: mockPreferencesPort,
        verificationPort: portWithSpy,
      });

      const result = orch.repairModelDownload(QWEN_CODER_3B);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.nextState, "model_downloading");
      assert.strictEqual(clearedModelId, QWEN_CODER_3B);
    });
  });

  describe("handleModelError", () => {
    it("should update cache as incomplete and return error state", () => {
      let updatedMetadata: any = {};
      const portWithSpy = {
        ...mockVerificationPort,
        updateModelCacheMetadata: (modelId: string, updates: any) => {
          updatedMetadata = { modelId, updates };
        },
      };

      const orch = createModelDownloadOrchestrator({
        preferencesPort: mockPreferencesPort,
        verificationPort: portWithSpy,
      });

      const result = orch.handleModelError(QWEN_CODER_3B, "test error");
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.nextState, "error");
      assert.strictEqual(result.error, "test error");
      assert.strictEqual(result.errorCode, "network_failure");
      assert.strictEqual(updatedMetadata.updates.downloadCompleted, false);
    });
  });
});
