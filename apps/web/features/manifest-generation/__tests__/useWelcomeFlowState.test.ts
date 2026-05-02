import { JSDOM } from "jsdom";
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  url: "http://localhost/",
});
global.window = dom.window as unknown as Window & typeof globalThis;
global.document = dom.window.document as unknown as Document;

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useWelcomeFlowState } from "../ModelSelectionFlow/useWelcomeFlowState";
import type {
  LocalLLMContext,
  LocalLLMState,
  DomainModelId,
} from "../../../lib/llm-interfaces";

// Mock dependencies
mock.module("../../../lib/llm-interfaces", () => ({
  LocalLLMContext: {},
}));

mock.module("./modelPreferencesStorage", () => ({
  getModelPreferences: () => ({}),
  saveModelPreferences: () => {},
  createApiKeyManager: async () => ({
    saveApiKey: async () => {},
    getApiKey: async () => null,
    clearApiKeys: async () => {},
  }),
}));

mock.module("./useWebGPUDetection", () => ({
  useWebGPUDetection: () => ({
    isLoading: false,
    isWebGPUSupported: true,
    isBrowserSupported: true,
    isHardwareAdequate: true,
    estimatedVRAM: 4096,
    isRecommended: true,
  }),
}));

mock.module("../../../app/lib/wire", () => ({
  getSecretVault: () => ({}),
}));

describe("useWelcomeFlowState", () => {
  let mockEngineState: LocalLLMState;
  let mockInitializeModel: mock.Mock<(modelId: string) => Promise<void>>;
  let mockCancelDownload: mock.Mock<() => void>;
  let mockHasAnyCachedModel: mock.Mock<() => Promise<boolean>>;
  let mockHasModelInCache: mock.Mock<(modelId: string) => Promise<boolean>>;
  let llmContext: LocalLLMContext;

  beforeEach(() => {
    mockEngineState = { status: "idle", progress: 0 };
    mockInitializeModel = mock.fn();
    mockCancelDownload = mock.fn();
    mockHasAnyCachedModel = mock.fn(async () => false);
    mockHasModelInCache = mock.fn(async () => false);

    llmContext = {
      engineState: mockEngineState,
      initializeModel: mockInitializeModel,
      cancelDownload: mockCancelDownload,
      hasAnyCachedModel: mockHasAnyCachedModel,
      hasModelInCache: mockHasModelInCache,
    };
  });

  afterEach(() => {
    mock.reset();
  });

  describe("Initial State", () => {
    it("should start in idle state", () => {
      const { result } = renderHook(() => useWelcomeFlowState(llmContext));
      assert.strictEqual(result.current[0].state, "idle");
    });

    it("should detect unsupported WebGPU and transition to unsupported", () => {
      // Override the WebGPU detection mock
      mock.module("./useWebGPUDetection", () => ({
        useWebGPUDetection: () => ({
          isLoading: false,
          isWebGPUSupported: false,
          isBrowserSupported: true,
          isHardwareAdequate: true,
          estimatedVRAM: 0,
          isRecommended: false,
        }),
      }));

      const { result } = renderHook(() => useWelcomeFlowState(llmContext));
      // Wait for the effect to run
      act(() => {});
      assert.strictEqual(result.current[0].state, "unsupported");
    });

    it("should set webgpu_unavailable error code when WebGPU is not supported", () => {
      mock.module("./useWebGPUDetection", () => ({
        useWebGPUDetection: () => ({
          isLoading: false,
          isWebGPUSupported: false,
          isBrowserSupported: true,
          isHardwareAdequate: true,
          estimatedVRAM: 0,
          isRecommended: false,
        }),
      }));

      const { result } = renderHook(() => useWelcomeFlowState(llmContext));
      act(() => {});
      assert.strictEqual(result.current[0].errorCode, "webgpu_unavailable");
    });
  });

  describe("State Transitions", () => {
    it("should transition idle → model_selection (user clicks prefer local)", () => {
      const { result } = renderHook(() => useWelcomeFlowState(llmContext));
      const { transitionTo } = result.current[1];

      act(() => {
        transitionTo("model_selection");
      });

      assert.strictEqual(result.current[0].state, "model_selection");
    });

    it("should transition model_selection → model_downloading (user selects model)", () => {
      const { result } = renderHook(() => useWelcomeFlowState(llmContext));
      const { selectLocalModel } = result.current[1];

      act(() => {
        selectLocalModel("test-model" as DomainModelId, false);
      });

      assert.strictEqual(result.current[0].state, "model_downloading");
      assert.strictEqual(result.current[0].selectedModelId, "test-model");
      assert.strictEqual(result.current[0].generationProgress, 0);
    });

    it("should transition model_downloading → generating (model ready)", async () => {
      const { result } = renderHook(() => useWelcomeFlowState(llmContext));
      const { selectLocalModel } = result.current[1];

      act(() => {
        selectLocalModel("test-model" as DomainModelId, false);
      });

      // Simulate engine state change to ready
      act(() => {
        mockEngineState.status = "ready";
        // Re-render to pick up engine state change
        void result.current[0]; // Access to trigger re-render
      });

      await waitFor(() => {
        assert.strictEqual(result.current[0].state, "generating");
      });
    });

    it("should transition model_downloading → error (download fails)", async () => {
      const { result } = renderHook(() => useWelcomeFlowState(llmContext));
      const { selectLocalModel } = result.current[1];

      // Make initializeModel throw an error
      mockInitializeModel.mock.mockImplementationOnce(async () => {
        throw new Error("Download failed");
      });

      act(() => {
        selectLocalModel("test-model" as DomainModelId, false);
      });

      await waitFor(() => {
        assert.strictEqual(result.current[0].state, "error");
        assert.ok(result.current[0].error);
      });
    });

    it("should transition generating → preview (manifest generated)", () => {
      const { result } = renderHook(() => useWelcomeFlowState(llmContext));
      const { saveGenerationResult } = result.current[1];

      act(() => {
        saveGenerationResult("manifest: true");
      });

      assert.strictEqual(result.current[0].state, "preview");
      assert.strictEqual(result.current[0].manifestContent, "manifest: true");
    });

    it("should transition generating → error (generation fails)", () => {
      const { result } = renderHook(() => useWelcomeFlowState(llmContext));
      const { setError } = result.current[1];

      act(() => {
        setError("Generation failed");
      });

      assert.strictEqual(result.current[0].state, "error");
      assert.strictEqual(result.current[0].error, "Generation failed");
    });

    it("should transition error → idle (user retries)", () => {
      const { result } = renderHook(() => useWelcomeFlowState(llmContext));
      const { setError, retryGeneration } = result.current[1];

      // First go to error state
      act(() => {
        setError("Error occurred");
      });
      assert.strictEqual(result.current[0].state, "error");

      // Retry back to idle
      act(() => {
        retryGeneration();
      });

      assert.strictEqual(result.current[0].state, "idle");
    });

    it("should transition to interrupted state (user cancels download)", () => {
      const { result } = renderHook(() => useWelcomeFlowState(llmContext));
      const { selectLocalModel, cancelModelDownload } = result.current[1];

      // Start downloading
      act(() => {
        selectLocalModel("test-model" as DomainModelId, false);
      });
      assert.strictEqual(result.current[0].state, "model_downloading");

      // Cancel download
      act(() => {
        cancelModelDownload();
      });

      assert.strictEqual(result.current[0].state, "interrupted");
      assert.strictEqual(mockCancelDownload.mock.callCount(), 1);
    });

    it("should transition to unsupported state (WebGPU not available)", () => {
      // This was tested in Initial State, but confirm
      mock.module("./useWebGPUDetection", () => ({
        useWebGPUDetection: () => ({
          isLoading: false,
          isWebGPUSupported: false,
          isBrowserSupported: true,
          isHardwareAdequate: true,
          estimatedVRAM: 0,
          isRecommended: false,
        }),
      }));

      const { result } = renderHook(() => useWelcomeFlowState(llmContext));
      act(() => {});
      assert.strictEqual(result.current[0].state, "unsupported");
    });

    it("should reject manifest preserving lastRejectedManifest", () => {
      const { result } = renderHook(() => useWelcomeFlowState(llmContext));
      const { saveGenerationResult, rejectManifest } = result.current[1];

      act(() => {
        saveGenerationResult("manifest: content");
      });
      assert.strictEqual(result.current[0].state, "preview");

      act(() => {
        rejectManifest();
      });

      assert.strictEqual(result.current[0].state, "model_selection");
      assert.strictEqual(
        result.current[0].lastRejectedManifest,
        "manifest: content",
      );
      assert.strictEqual(result.current[0].manifestContent, undefined);
      assert.strictEqual(result.current[0].error, null);
    });

    it("should regenerate manifest transitioning preview → generating", () => {
      const { result } = renderHook(() => useWelcomeFlowState(llmContext));
      const { saveGenerationResult, regenerateManifest } = result.current[1];

      act(() => {
        saveGenerationResult("manifest: content");
      });
      assert.strictEqual(result.current[0].state, "preview");

      act(() => {
        regenerateManifest();
      });

      assert.strictEqual(result.current[0].state, "generating");
      assert.strictEqual(result.current[0].manifestContent, undefined);
      assert.strictEqual(result.current[0].error, null);
    });

    it("should clear manifest content on regenerate", () => {
      const { result } = renderHook(() => useWelcomeFlowState(llmContext));
      const { saveGenerationResult, regenerateManifest } = result.current[1];

      act(() => {
        saveGenerationResult("old manifest");
      });

      act(() => {
        regenerateManifest();
      });

      assert.strictEqual(result.current[0].manifestContent, undefined);
    });
  });

  describe("Actions", () => {
    it("should validate API key with correct format", async () => {
      const { result } = renderHook(() => useWelcomeFlowState(llmContext));
      const { validateApiKey } = result.current[1];

      // Test OpenAI key format
      let isValid = await act(async () =>
        validateApiKey("openai", "sk-validkey12345678"),
      );
      assert.strictEqual(isValid, true);

      // Test invalid OpenAI key
      isValid = await act(async () => validateApiKey("openai", "invalid-key"));
      assert.strictEqual(isValid, false);

      // Test Anthropic key format
      isValid = await act(async () =>
        validateApiKey("anthropic", "sk-ant-validkey12345678"),
      );
      assert.strictEqual(isValid, true);

      // Test invalid Anthropic key
      isValid = await act(async () =>
        validateApiKey("anthropic", "invalid-key"),
      );
      assert.strictEqual(isValid, false);

      // Test short key
      isValid = await act(async () => validateApiKey("openai", "short"));
      assert.strictEqual(isValid, false);
    });

    it("should select local model with remember=true/false", () => {
      const { result } = renderHook(() => useWelcomeFlowState(llmContext));
      const { selectLocalModel } = result.current[1];

      // Test with remember=true
      act(() => {
        selectLocalModel("model-1" as DomainModelId, true);
      });
      assert.strictEqual(result.current[0].rememberedChoice, true);

      // Test with remember=false
      act(() => {
        selectLocalModel("model-2" as DomainModelId, false);
      });
      assert.strictEqual(result.current[0].rememberedChoice, false);
    });

    it("should cancel model download", () => {
      const { result } = renderHook(() => useWelcomeFlowState(llmContext));
      const { cancelModelDownload } = result.current[1];

      act(() => {
        cancelModelDownload();
      });

      assert.strictEqual(mockCancelDownload.mock.callCount(), 1);
    });

    it("should skip AI setup", () => {
      const { result } = renderHook(() => useWelcomeFlowState(llmContext));
      const { skipAiSetup } = result.current[1];

      act(() => {
        skipAiSetup();
      });

      assert.strictEqual(result.current[0].aiSetupSkipped, true);
      assert.strictEqual(result.current[0].state, "idle");
    });

    it("should clear error and return to idle", () => {
      const { result } = renderHook(() => useWelcomeFlowState(llmContext));
      const { setError, clearError } = result.current[1];

      act(() => {
        setError("Test error");
      });
      assert.strictEqual(result.current[0].state, "error");

      act(() => {
        clearError();
      });
      assert.strictEqual(result.current[0].state, "idle");
      assert.strictEqual(result.current[0].error, null);
    });

    it("should restart from selection", () => {
      const { result } = renderHook(() => useWelcomeFlowState(llmContext));
      const { setError, restartFromSelection } = result.current[1];

      act(() => {
        setError("Test error");
      });
      assert.strictEqual(result.current[0].state, "error");

      act(() => {
        restartFromSelection();
      });
      assert.strictEqual(result.current[0].state, "model_selection");
      assert.strictEqual(result.current[0].error, null);
    });

    it("should proceed to wizard", () => {
      const { result } = renderHook(() => useWelcomeFlowState(llmContext));
      const { proceedToWizard } = result.current[1];

      act(() => {
        proceedToWizard();
      });

      assert.strictEqual(result.current[0].state, "wizard_hydration");
    });

    it("should set error with error code", () => {
      const { result } = renderHook(() => useWelcomeFlowState(llmContext));
      const { setError } = result.current[1];

      act(() => {
        setError("Network error", "network_failure");
      });

      assert.strictEqual(result.current[0].state, "error");
      assert.strictEqual(result.current[0].error, "Network error");
      assert.strictEqual(result.current[0].errorCode, "network_failure");
    });

    it("should set key_invalid_format error code when cloud key validation fails", async () => {
      const { result } = renderHook(() => useWelcomeFlowState(llmContext));
      const { selectCloudProvider } = result.current[1];

      await act(async () => {
        await selectCloudProvider("openai", "bad-key", false);
      });

      assert.strictEqual(result.current[0].state, "error");
      assert.strictEqual(result.current[0].errorCode, "key_invalid_format");
    });
  });

  describe("Race Condition Guard", () => {
    it("should ignore stale model initialization errors after cancel", async () => {
      // Make initializeModel take time, then fail
      let rejectModel: ((err: Error) => void) | null = null;
      mockInitializeModel.mock.mockImplementation(async () => {
        return new Promise<never>((_, reject) => {
          rejectModel = reject;
        });
      });

      const { result } = renderHook(() => useWelcomeFlowState(llmContext));
      const { selectLocalModel, cancelModelDownload } = result.current[1];

      // Start model download
      act(() => {
        selectLocalModel("model-a" as DomainModelId, false);
      });

      // Cancel the download (increments intent counter)
      act(() => {
        cancelModelDownload();
      });
      assert.strictEqual(result.current[0].state, "interrupted");

      // The stale download then fails — should NOT trigger error state
      await act(async () => {
        rejectModel!(new Error("Download failed"));
        // Wait for promise rejection to settle
        await new Promise((r) => setTimeout(r, 0));
      });

      // State should remain interrupted, not error
      assert.strictEqual(result.current[0].state, "interrupted");
    });

    it("should ignore stale model initialization errors when selecting new model", async () => {
      // First model takes time and fails
      let rejectModelA: ((err: Error) => void) | null = null;
      mockInitializeModel.mock.mockImplementationOnce(async () => {
        return new Promise<never>((_, reject) => {
          rejectModelA = reject;
        });
      });

      // Second model resolves immediately
      mockInitializeModel.mock.mockImplementationOnce(async () => {
        return Promise.resolve();
      });

      const { result } = renderHook(() => useWelcomeFlowState(llmContext));
      const { selectLocalModel } = result.current[1];

      // Start model A download
      act(() => {
        selectLocalModel("model-a" as DomainModelId, false);
      });

      assert.strictEqual(result.current[0].selectedModelId, "model-a");
      assert.strictEqual(result.current[0].state, "model_downloading");

      // User switches to model B before A completes
      act(() => {
        selectLocalModel("model-b" as DomainModelId, false);
      });

      assert.strictEqual(result.current[0].selectedModelId, "model-b");
      assert.strictEqual(result.current[0].state, "model_downloading");

      // Model A now fails — should NOT trigger error state
      await act(async () => {
        rejectModelA!(new Error("Model A failed"));
        await new Promise((r) => setTimeout(r, 0));
      });

      // State should remain model_downloading (waiting for model B)
      assert.strictEqual(result.current[0].state, "model_downloading");
      assert.strictEqual(result.current[0].selectedModelId, "model-b");
    });
  });
});
