import { describe, it, expect } from "node:test";
import { createModelDownloadOrchestrator } from "../../src/application/use-cases/model-download-orchestrator.use-case";

type DomainModelId = "qwen-coder-3b" | "llama-3.2-3b" | "phi-3.5-mini" | "gemma-2-2b" | "qwen-coder-1.5b" | "llama-3.2-1b" | "qwen-coder-0.5b";

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

  const orchestrator = createModelDownloadOrchestrator({
    preferencesPort: mockPreferencesPort,
    verificationPort: mockVerificationPort,
  });

  describe("selectLocalModel", () => {
    it("should return success with model_downloading state", () => {
      const result = orchestrator.selectLocalModel({
        modelId: QWEN_CODER_3B,
        remember: false,
      });
      expect(result.success).toBe(true);
      expect(result.nextState).toBe("model_downloading");
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

      expect(savedPreferences.lastModelId).toBe(QWEN_CODER_3B);
      expect(savedPreferences.autoLoadEnabled).toBe(true);
      expect(savedPreferences.hasEnabledLocalModels).toBe(true);
      expect(savedPreferences.rememberChoice).toBe(true);
    });
  });

  describe("cancelDownload", () => {
    it("should return interrupted state and update preferences", () => {
      let clearedPreferences = false;
      const portWithSpy = {
        ...mockPreferencesPort,
        setPreferences: (prefs: any) => {
          if (prefs.autoLoadEnabled === false && prefs.rememberChoice === false) {
            clearedPreferences = true;
          }
        },
      };

      const orch = createModelDownloadOrchestrator({
        preferencesPort: portWithSpy,
        verificationPort: mockVerificationPort,
      });

      const result = orch.cancelDownload();
      expect(result.success).toBe(true);
      expect(result.nextState).toBe("interrupted");
      expect(clearedPreferences).toBe(true);
    });
  });

  describe("selectCloudProvider", () => {
    it("should validate API key format for openai", () => {
      const result = orchestrator.selectCloudProvider({
        provider: "openai",
        apiKey: "invalid-key",
        remember: false,
      });

      expect(result.success).toBe(false);
      expect(result.nextState).toBe("error");
      expect(result.errorCode).toBe("key_invalid_format");
    });

    it("should validate API key format for anthropic", () => {
      const result = orchestrator.selectCloudProvider({
        provider: "anthropic",
        apiKey: "invalid-key",
        remember: false,
      });

      expect(result.success).toBe(false);
      expect(result.nextState).toBe("error");
      expect(result.errorCode).toBe("key_invalid_format");
    });

    it("should accept valid openai key", () => {
      const result = orchestrator.selectCloudProvider({
        provider: "openai",
        apiKey: "sk-test123456",
        remember: false,
      });

      expect(result.success).toBe(true);
      expect(result.nextState).toBe("generating");
    });

    it("should accept valid anthropic key", () => {
      const result = orchestrator.selectCloudProvider({
        provider: "anthropic",
        apiKey: "sk-ant-test123456",
        remember: false,
      });

      expect(result.success).toBe(true);
      expect(result.nextState).toBe("generating");
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
      expect(result.success).toBe(true);
      expect(result.nextState).toBe("idle");
      expect(savedPrefs).toBe(true);
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
      expect(result.success).toBe(true);
      expect(result.nextState).toBe("generating");
      expect(updatedMetadata.modelId).toBe(QWEN_CODER_3B);
      expect(updatedMetadata.updates.verifiedAt).toBeDefined();
      expect(updatedMetadata.updates.downloadCompleted).toBe(true);
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
      expect(result.success).toBe(true);
      expect(result.nextState).toBe("model_downloading");
      expect(clearedModelId).toBe(QWEN_CODER_3B);
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
      expect(result.success).toBe(false);
      expect(result.nextState).toBe("error");
      expect(result.error).toBe("test error");
      expect(result.errorCode).toBe("network_failure");
      expect(updatedMetadata.updates.downloadCompleted).toBe(false);
    });
  });
});