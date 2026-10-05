// --- Hoisted mock objects for the four collaborators resolved at mount ---

// 1. WebGPU detector (GraphicsCapabilityPort)
const mockGpuDetector = vi.hoisted(() => ({
  isSupported: vi.fn(() => false),
  detect: vi.fn(async () => ({
    success: true,
    value: { supported: false, maxTextureSize: null, supportsFP16: false },
  })),
}));

// 2. Hardware profiler (HardwareProfilerPort)
const mockHwProfiler = vi.hoisted(() => ({
  profile: vi.fn(async () => ({
    success: true,
    value: {
      cpuCores: 4,
      ramMB: null,
      gpu: { supported: false, vendor: null, architecture: null, maxBufferMB: null },
      deviceClass: "unknown",
    },
  })),
}));

// 3. Key vault (UserSecretVaultPort)
const mockSecretVault = vi.hoisted(() => ({
  getStatus: vi.fn(async () => ({
    success: true,
    value: { state: "empty", hasStoredPayload: false },
  })),
  store: vi.fn(async () => ({ success: true })),
  retrieve: vi.fn(async () => ({ success: false, error: new Error("no key") })),
  destroy: vi.fn(async () => ({ success: true })),
  unlock: vi.fn(async () => ({ success: true })),
  lock: vi.fn(async () => ({ success: true })),
}));

// Mock ApiKeyManager returned by createApiKeyManager
const mockApiKeyManager = vi.hoisted(() => ({
  saveApiKey: vi.fn(async () => undefined),
  getApiKey: vi.fn(async () => null),
  clearApiKeys: vi.fn(async () => undefined),
}));

// 4. Preferences store
const mockPreferences = vi.hoisted(() => ({
  hasEnabledLocalModels: false,
  lastModelId: null,
  autoLoadEnabled: false,
  cloudProvider: null,
  rememberApiKey: false,
  skipAiSetup: false,
  rememberChoice: false,
}));

// Hoisted factory mocks for wire module
const mockGetWebGPUDetector = vi.hoisted(() => vi.fn(() => mockGpuDetector));
const mockGetHardwareProfiler = vi.hoisted(() => vi.fn(() => mockHwProfiler));
const mockGetSecretVault = vi.hoisted(() => vi.fn(() => mockSecretVault));
const mockHasServerLLMAccessKey = vi.hoisted(() => vi.fn(() => false));

// Seam: wire module — getWebGPUDetector, getHardwareProfiler, getSecretVault, hasServerLLMAccessKey
vi.mock("../../../app/lib/wire", () => ({
  getWebGPUDetector: mockGetWebGPUDetector,
  getHardwareProfiler: mockGetHardwareProfiler,
  getSecretVault: mockGetSecretVault,
  hasServerLLMAccessKey: mockHasServerLLMAccessKey,
}));

// Hoisted factory mocks for modelPreferencesStorage module
const mockGetModelPreferences = vi.hoisted(() => vi.fn(() => mockPreferences));
const mockCreateApiKeyManager = vi.hoisted(() => vi.fn(async () => mockApiKeyManager));
const mockSaveModelPreferences = vi.hoisted(() => vi.fn());
const mockIsModelVerified = vi.hoisted(() => vi.fn(() => false));
const mockUpdateModelCacheMetadata = vi.hoisted(() => vi.fn());
const mockClearModelCacheMetadata = vi.hoisted(() => vi.fn());

// Seam: modelPreferencesStorage — getModelPreferences, saveModelPreferences,
// createApiKeyManager, isModelVerified, updateModelCacheMetadata, etc.
vi.mock("../ModelSelectionFlow/modelPreferencesStorage", () => ({
  getModelPreferences: mockGetModelPreferences,
  saveModelPreferences: mockSaveModelPreferences,
  createApiKeyManager: mockCreateApiKeyManager,
  isModelVerified: mockIsModelVerified,
  updateModelCacheMetadata: mockUpdateModelCacheMetadata,
  clearModelCacheMetadata: mockClearModelCacheMetadata,
  MODEL_PREFERENCE_KEYS: {
    LAST_MODEL_ID: "hexagen:local-llm:last-model",
    AUTO_LOAD_ENABLED: "hexagen:local-llm:auto-load",
    HAS_ENABLED_LOCAL_MODELS: "hexagen:local-llm:has-enabled",
    CLOUD_PROVIDER: "hexagen:manifest-flow:cloud-provider",
    REMEMBER_API_KEY: "hexagen:manifest-flow:remember-api-key",
    SKIP_AI_SETUP: "hexagen:manifest-flow:skip-ai-setup",
    REMEMBER_CHOICE: "hexagen:manifest-flow:remember-choice",
    MODEL_CACHE_METADATA_PREFIX: "hexagen:local-llm:cache-metadata:",
  },
  STORAGE_KEYS: {
    LAST_MODEL_ID: "hexagen:local-llm:last-model",
    AUTO_LOAD_ENABLED: "hexagen:local-llm:auto-load",
    HAS_ENABLED_LOCAL_MODELS: "hexagen:local-llm:has-enabled",
    CLOUD_PROVIDER: "hexagen:manifest-flow:cloud-provider",
    REMEMBER_API_KEY: "hexagen:manifest-flow:remember-api-key",
    SKIP_AI_SETUP: "hexagen:manifest-flow:skip-ai-setup",
    REMEMBER_CHOICE: "hexagen:manifest-flow:remember-choice",
    MODEL_CACHE_METADATA_PREFIX: "hexagen:local-llm:cache-metadata:",
  },
}));

import { describe, it, beforeEach, afterEach, vi, type Mock } from "vitest";
import assert from "node:assert";
import { renderHook, act } from "@testing-library/react";
import { useModelSelectionFlowState } from "../ModelSelectionFlow/useModelSelectionFlowState";
import type { LocalLLMContext } from "../../../lib/llm-interfaces";
import { createLLMEngineState, type LLMEngineState, DomainModelId } from "@hexagen/local-llm";

describe("useModelSelectionFlowState", () => {
  let mockEngineState: LLMEngineState;
  let mockInitializeModel: Mock<(modelId: string) => Promise<void>>;
  let mockCancelDownload: Mock<() => void>;
  let mockHasAnyCachedModel: Mock<() => Promise<boolean>>;
  let mockHasModelInCache: Mock<(modelId: string) => Promise<boolean>>;
  let llmContext: LocalLLMContext;

  beforeEach(() => {
    // "unavailable" is the engine's real initial status (LLM_ENGINE_INITIAL_STATE).
    mockEngineState = createLLMEngineState("unavailable", 0);
    mockInitializeModel = vi.fn(async () => {});
    mockCancelDownload = vi.fn();
    mockHasAnyCachedModel = vi.fn(async () => false);
    mockHasModelInCache = vi.fn(async () => false);

    llmContext = {
      engineState: mockEngineState,
      initializeModel: mockInitializeModel,
      cancelDownload: mockCancelDownload,
      hasAnyCachedModel: mockHasAnyCachedModel,
      hasModelInCache: mockHasModelInCache,
      switchModel: async () => {},
      deleteCachedModel: async () => {},
      loadedModel: null,
      sendGovernanceMessage: async () => {},
      sendStructuredPrompt: async () => "",
      messages: [],
    };

    // Reset mock implementations to deterministic defaults
    mockGpuDetector.isSupported.mockReturnValue(false);
    mockGpuDetector.detect.mockResolvedValue({
      success: true,
      value: { supported: false, maxTextureSize: null, supportsFP16: false },
    });
    mockHwProfiler.profile.mockResolvedValue({
      success: true,
      value: {
        cpuCores: 4,
        ramMB: null,
        gpu: { supported: false, vendor: null, architecture: null, maxBufferMB: null },
        deviceClass: "unknown",
      },
    });
    mockGetWebGPUDetector.mockReturnValue(mockGpuDetector);
    mockGetHardwareProfiler.mockReturnValue(mockHwProfiler);
    mockGetSecretVault.mockReturnValue(mockSecretVault);
    mockHasServerLLMAccessKey.mockReturnValue(false);

    // Reset preferences to defaults
    mockPreferences.hasEnabledLocalModels = false;
    mockPreferences.lastModelId = null;
    mockPreferences.autoLoadEnabled = false;
    mockPreferences.cloudProvider = null;
    mockPreferences.rememberApiKey = false;
    mockPreferences.skipAiSetup = false;
    mockPreferences.rememberChoice = false;
    mockGetModelPreferences.mockReturnValue(mockPreferences);
    mockCreateApiKeyManager.mockResolvedValue(mockApiKeyManager);
    mockIsModelVerified.mockReturnValue(false);

    // Reset mock call history
    mockSaveModelPreferences.mockClear();
    mockUpdateModelCacheMetadata.mockClear();
    mockClearModelCacheMetadata.mockClear();
    mockCancelDownload.mockClear();
    mockInitializeModel.mockReset();
    mockInitializeModel.mockImplementation(async () => {});
    mockHasAnyCachedModel.mockReset();
    mockHasAnyCachedModel.mockImplementation(async () => false);
    mockHasModelInCache.mockReset();
    mockHasModelInCache.mockImplementation(async () => false);
    mockApiKeyManager.saveApiKey.mockClear();
    mockApiKeyManager.getApiKey.mockClear();
    mockApiKeyManager.clearApiKeys.mockClear();
    mockSecretVault.store.mockClear();
    mockSecretVault.retrieve.mockClear();
    mockSecretVault.destroy.mockClear();
    mockGpuDetector.isSupported.mockClear();
    mockGpuDetector.detect.mockClear();
    mockHwProfiler.profile.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Mount the hook and settle its asynchronous mount effects.
   *
   * `useModelSelectionFlowEffects` starts two promises on mount that each end
   * in a `setState`: `createApiKeyManager(getSecretVault()).then(setApiKeyManager)`
   * and, via `useWebGPUDetection`, `Promise.all([detect(), profile()]).then(setResult)`
   * — the latter then feeds a third `setFlowState` for `hardwareCapabilities`.
   * Neither settles inside `renderHook`'s synchronous `act` window, so every
   * test that mounted the hook and returned synchronously left React updating
   * outside `act()` (two warnings per test, 40 across this file) and asserted
   * against pre-flush state.
   *
   * Draining a macrotask inside `await act(async …)` settles both chains — and
   * every microtask they queue — before the assertions run, so `result.current`
   * is the state the component would actually render with.
   */
  async function renderFlowState() {
    const view = renderHook(() => useModelSelectionFlowState(llmContext));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return view;
  }

  describe("Initial State", () => {
    it("should start in idle state", async () => {
      const { result } = await renderFlowState();
      assert.strictEqual(result.current[0].state, "idle");
      assert.strictEqual(result.current[0].isModelReady, false);
    });

    // DELETED: "should detect unsupported WebGPU and transition to unsupported"
    // — the hook's effects never transition to the "unsupported" state on
    //   WebGPU-failure; they only set hardwareCapabilities.isWebGPUSupported=false.
    // DELETED: "should set webgpu_unavailable error code when WebGPU is not supported"
    // – no code path assigns errorCode:"webgpu_unavailable" from detection.
  });

  describe("State Transitions", () => {
    it("should transition idle → model_selection (user clicks prefer local)", async () => {
      const { result } = await renderFlowState();
      const { transitionTo } = result.current[1];

      act(() => {
        transitionTo("model_selection");
      });

      assert.strictEqual(result.current[0].state, "model_selection");
    });

    it("should transition model_selection → model_downloading (user selects model)", async () => {
      const { result } = await renderFlowState();
      const { selectLocalModel } = result.current[1];

      await act(async () => {
        selectLocalModel(DomainModelId.QWEN3_8B, true);
      });

      assert.strictEqual(result.current[0].state, "model_downloading");
      assert.strictEqual(result.current[0].selectedModelId, DomainModelId.QWEN3_8B);
      assert.strictEqual(result.current[0].rememberedChoice, true);
      assert.strictEqual(result.current[0].generationProgress, 0);
    });

    it("should transition model_downloading → generating (model ready)", async () => {
      llmContext = {
        ...llmContext,
        engineState: createLLMEngineState("ready", 100, DomainModelId.QWEN3_8B),
      };
      mockIsModelVerified.mockReturnValue(true);
      const { result } = await renderFlowState();
      assert.strictEqual(result.current[0].state, "idle");

      const { selectLocalModel } = result.current[1];
      await act(async () => {
        selectLocalModel(DomainModelId.QWEN3_8B, false);
      });

      assert.strictEqual(result.current[0].state, "generating");
      assert.strictEqual(result.current[0].isModelReady, true);
    });

    it("should transition model_downloading → error (download fails)", async () => {
      mockInitializeModel.mockRejectedValue(new Error("Download failed"));
      llmContext = { ...llmContext, initializeModel: mockInitializeModel };
      const { result } = await renderFlowState();
      const { selectLocalModel } = result.current[1];

      await act(async () => {
        selectLocalModel(DomainModelId.QWEN3_8B, true);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      assert.strictEqual(result.current[0].state, "error");
      assert.strictEqual(result.current[0].error, "Download failed");
    });

    it("should transition generating → error (generation fails)", async () => {
      const { result } = await renderFlowState();
      const { transitionTo, setError } = result.current[1];

      act(() => {
        transitionTo("generating");
      });
      assert.strictEqual(result.current[0].state, "generating");

      act(() => {
        setError("Generation failed");
      });
      assert.strictEqual(result.current[0].state, "error");
      assert.strictEqual(result.current[0].error, "Generation failed");
    });

    it("should transition error → idle (user retries)", async () => {
      const { result } = await renderFlowState();
      const { setError, retryGeneration } = result.current[1];

      act(() => {
        setError("Error occurred");
      });
      assert.strictEqual(result.current[0].state, "error");

      act(() => {
        retryGeneration();
      });
      assert.strictEqual(result.current[0].state, "idle");
      assert.strictEqual(result.current[0].error, null);
    });

    it("should transition to interrupted state (user cancels download)", async () => {
      const { result } = await renderFlowState();
      const { cancelModelDownload } = result.current[1];

      act(() => {
        cancelModelDownload();
      });

      assert.strictEqual(result.current[0].state, "interrupted");
      assert.strictEqual(result.current[0].isModelReady, false);
      assert.ok(mockCancelDownload.mock.calls.length > 0);
    });

    // DELETED: "should transition to unsupported state (WebGPU not available)"
    // — the hook does not transition to "unsupported" based on WebGPU detection.

    it("should regenerate manifest transitioning to generating", async () => {
      const { result } = await renderFlowState();
      const { setError, regenerateManifest } = result.current[1];

      act(() => {
        setError("Generation failed");
      });
      assert.strictEqual(result.current[0].state, "error");

      act(() => {
        regenerateManifest();
      });

      assert.strictEqual(result.current[0].state, "generating");
      assert.strictEqual(result.current[0].error, null);
    });
  });

  describe("Actions", () => {
    it("should validate API key with correct format", async () => {
      const { result } = await renderFlowState();
      const { validateApiKey } = result.current[1];

      // Invalid format (missing sk- prefix) → false
      const invalidResult = await validateApiKey("openai", "bad-key");
      assert.strictEqual(invalidResult, false);

      // Valid format → true (after 500ms async validation delay)
      vi.useFakeTimers();
      const validPromise = validateApiKey("openai", "sk-valid-key-123");
      await vi.advanceTimersByTimeAsync(500);
      const validResult = await validPromise;
      assert.strictEqual(validResult, true);
      vi.useRealTimers();
    });

    it("should select local model with remember=true/false", async () => {
      const { result } = await renderFlowState();
      const { selectLocalModel } = result.current[1];

      // With remember=true → saves preferences, sets selectedModelId and rememberedChoice
      await act(async () => {
        selectLocalModel(DomainModelId.QWEN3_8B, true);
      });
      assert.strictEqual(result.current[0].state, "model_downloading");
      assert.strictEqual(result.current[0].selectedModelId, DomainModelId.QWEN3_8B);
      assert.strictEqual(result.current[0].rememberedChoice, true);
      assert.ok(
        mockSaveModelPreferences.mock.calls.some(
          (call) => call[0]?.lastModelId === DomainModelId.QWEN3_8B,
        ),
      );

      // With remember=false → does NOT save lastModelId preference
      mockSaveModelPreferences.mockClear();
      await act(async () => {
        selectLocalModel(DomainModelId.LLAMA_3_2_3B, false);
      });
      assert.strictEqual(result.current[0].selectedModelId, DomainModelId.LLAMA_3_2_3B);
      assert.strictEqual(result.current[0].rememberedChoice, false);
      assert.ok(
        !mockSaveModelPreferences.mock.calls.some(
          (call) => call[0]?.lastModelId !== undefined,
        ),
      );
    });

    it("should cancel model download", async () => {
      const { result } = await renderFlowState();
      const { cancelModelDownload } = result.current[1];

      act(() => {
        cancelModelDownload();
      });

      assert.strictEqual(result.current[0].state, "interrupted");
      assert.strictEqual(result.current[0].isModelReady, false);
      assert.ok(mockCancelDownload.mock.calls.length > 0);
      assert.ok(
        mockSaveModelPreferences.mock.calls.some(
          (call) => call[0]?.autoLoadEnabled === false,
        ),
      );
    });

    it("should skip AI setup", async () => {
      const { result } = await renderFlowState();
      const { skipAiSetup } = result.current[1];

      act(() => {
        skipAiSetup();
      });

      assert.strictEqual(result.current[0].state, "idle");
      assert.strictEqual(result.current[0].aiSetupSkipped, true);
      assert.ok(mockSaveModelPreferences.mock.calls.length > 0);
    });

    it("should clear error and return to idle", async () => {
      const { result } = await renderFlowState();
      const { setError, clearError } = result.current[1];

      act(() => {
        setError("Test error");
      });
      assert.strictEqual(result.current[0].state, "error");
      assert.strictEqual(result.current[0].error, "Test error");

      act(() => {
        clearError();
      });
      assert.strictEqual(result.current[0].state, "idle");
      assert.strictEqual(result.current[0].error, null);
    });

    it("should restart from selection", async () => {
      const { result } = await renderFlowState();
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

    it("should proceed to wizard", async () => {
      const { result } = await renderFlowState();
      const { proceedToWizard } = result.current[1];

      act(() => {
        proceedToWizard();
      });

      assert.strictEqual(result.current[0].state, "wizard_hydration");
    });

    it("should set error with error code", async () => {
      const { result } = await renderFlowState();
      const { setError } = result.current[1];

      act(() => {
        setError("Network error", "network_failure");
      });

      assert.strictEqual(result.current[0].state, "error");
      assert.strictEqual(result.current[0].error, "Network error");
      assert.strictEqual(result.current[0].errorCode, "network_failure");
    });

    it("should set key_invalid_format error code when cloud key validation fails", async () => {
      const { result } = await renderFlowState();
      const { selectCloudProvider } = result.current[1];

      await act(async () => {
        await selectCloudProvider("openai", "bad-key", false);
      });

      assert.strictEqual(result.current[0].state, "error");
      assert.strictEqual(result.current[0].errorCode, "key_invalid_format");
      assert.strictEqual(result.current[0].cloudProvider, "openai");
      assert.strictEqual(result.current[0].cloudApiKey, "bad-key");
    });
  });
});
