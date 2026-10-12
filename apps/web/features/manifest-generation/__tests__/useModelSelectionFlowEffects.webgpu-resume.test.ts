// Issue #766 follow-up: the remembered-model auto-resume in
// useModelSelectionFlowEffects (live on /projects/new/ai) must not call
// initializeModel when WebGPU is absent. Same rule as the model page (#873):
// detection resolved false, or engine status no_webgpu / unsupported_browser,
// means no call and the flow raises localUnsupportedNotice. While detection is
// still loading the resume waits; it runs once detection resolves.

import { describe, it, vi, beforeEach, type Mock } from "vitest";
import assert from "node:assert/strict";
import { renderHook, act } from "@testing-library/react";
import {
  createLLMEngineState,
  DomainModelId,
  type LLMEngineStatus,
} from "@hexagen/local-llm";

const gpu = vi.hoisted(() => ({
  current: {
    isWebGPUSupported: false,
    isBrowserSupported: false,
    isHardwareAdequate: false,
    estimatedVRAM: null,
    isRecommended: false,
    capability: null,
    isLoading: true,
  },
}));
vi.mock("../ModelSelectionFlow/useWebGPUDetection", () => ({
  useWebGPUDetection: () => gpu.current,
}));

const mockHasServerLLMAccessKey = vi.hoisted(() => vi.fn(() => false));
vi.mock("../../../app/lib/wire", () => ({
  getWebGPUDetector: vi.fn(),
  getHardwareProfiler: vi.fn(),
  getSecretVault: vi.fn(() => ({})),
  hasServerLLMAccessKey: mockHasServerLLMAccessKey,
}));

const mockGetModelPreferences = vi.hoisted(() => vi.fn());
vi.mock("../ModelSelectionFlow/modelPreferencesStorage", () => ({
  getModelPreferences: mockGetModelPreferences,
  saveModelPreferences: vi.fn(),
  createApiKeyManager: vi.fn(async () => ({
    saveApiKey: async () => undefined,
    getApiKey: async () => null,
    clearApiKeys: async () => undefined,
  })),
  isModelVerified: vi.fn(() => false),
  updateModelCacheMetadata: vi.fn(),
  clearModelCacheMetadata: vi.fn(),
}));

import { useModelSelectionFlowState } from "../ModelSelectionFlow/useModelSelectionFlowState";
import type { ModelPreferences } from "../ModelSelectionFlow/modelPreferencesStorage";
import type { LocalLLMContext } from "../../../lib/llm-interfaces";

const MODEL = DomainModelId.QWEN3_8B;

const makePrefs = (overrides: Partial<ModelPreferences>): ModelPreferences => ({
  hasEnabledLocalModels: false,
  lastModelId: null,
  autoLoadEnabled: false,
  cloudProvider: null,
  rememberApiKey: false,
  skipAiSetup: false,
  rememberChoice: false,
  ...overrides,
});

const makeContext = (status: LLMEngineStatus, cached: boolean) => {
  const initializeModel: Mock<(modelId: string) => Promise<void>> = vi.fn(
    async () => {},
  );
  const cancelDownload: Mock<() => void> = vi.fn();
  const hasModelInCache: Mock<(modelId: string) => Promise<boolean>> = vi.fn(
    async () => cached,
  );
  const ctx: LocalLLMContext = {
    engineState: createLLMEngineState(status, 0),
    initializeModel,
    cancelDownload,
    hasAnyCachedModel: async () => false,
    hasModelInCache,
    switchModel: async () => {},
    deleteCachedModel: async () => {},
    loadedModel: null,
    sendGovernanceMessage: async () => {},
    sendStructuredPrompt: async () => "",
    messages: [],
  };
  return { ctx, initializeModel, cancelDownload, hasModelInCache };
};

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const mount = async (ctx: LocalLLMContext) => {
  const view = renderHook(() => useModelSelectionFlowState(ctx));
  await flush();
  return view;
};

const setGpu = (isLoading: boolean, isWebGPUSupported: boolean) => {
  gpu.current = { ...gpu.current, isLoading, isWebGPUSupported };
};

const remember = (overrides: Partial<ModelPreferences>) => {
  mockGetModelPreferences.mockReturnValue(
    makePrefs({ lastModelId: MODEL, ...overrides }),
  );
};

beforeEach(() => {
  setGpu(true, false);
  mockHasServerLLMAccessKey.mockReturnValue(false);
  mockGetModelPreferences.mockReturnValue(makePrefs({}));
});

describe("remembered-model auto-resume: WebGPU absent (#766)", () => {
  it("a. detection false, remembered model not in cache: no initializeModel, notice raised", async () => {
    setGpu(false, false);
    remember({ rememberChoice: true });
    const { ctx, initializeModel, cancelDownload, hasModelInCache } =
      makeContext("unavailable", false);
    const { result } = await mount(ctx);
    assert.equal(initializeModel.mock.calls.length, 0);
    assert.equal(hasModelInCache.mock.calls.length, 0);
    assert.equal(cancelDownload.mock.calls.length, 0);
    assert.equal(result.current[0].state, "idle");
    assert.equal(result.current[0].localUnsupportedNotice, true);
    assert.equal(result.current[0].selectedModelId, undefined);
    assert.equal(result.current[0].isModelReady, false);
  });

  it("b. detection false, remembered model in cache: no initializeModel, not generating, not ready", async () => {
    setGpu(false, false);
    remember({ rememberChoice: true });
    const { ctx, initializeModel } = makeContext("unavailable", true);
    const { result } = await mount(ctx);
    assert.equal(initializeModel.mock.calls.length, 0);
    assert.equal(result.current[0].state, "idle");
    assert.equal(result.current[0].isModelReady, false);
    assert.equal(result.current[0].selectedModelId, undefined);
    assert.equal(result.current[0].localUnsupportedNotice, true);
  });

  it("c. detection false, autoLoadEnabled and cached: no initializeModel, notice raised", async () => {
    setGpu(false, false);
    remember({ autoLoadEnabled: true });
    const { ctx, initializeModel } = makeContext("unavailable", true);
    const { result } = await mount(ctx);
    assert.equal(initializeModel.mock.calls.length, 0);
    assert.equal(result.current[0].state, "idle");
    assert.equal(result.current[0].selectedModelId, undefined);
    assert.equal(result.current[0].localUnsupportedNotice, true);
  });

  const blockedStatuses: LLMEngineStatus[] = [
    "no_webgpu",
    "unsupported_browser",
  ];
  for (const status of blockedStatuses) {
    it(`h. engine status ${status} blocks the resume even when detection says supported`, async () => {
      setGpu(false, true);
      remember({ rememberChoice: true });
      const { ctx, initializeModel } = makeContext(status, false);
      const { result } = await mount(ctx);
      assert.equal(initializeModel.mock.calls.length, 0);
      assert.equal(result.current[0].state, "idle");
      assert.equal(result.current[0].localUnsupportedNotice, true);
    });
  }

  it("e. detection loading then true: waits, then resumes once", async () => {
    remember({ rememberChoice: true });
    const { ctx, initializeModel } = makeContext("unavailable", false);
    const view = await mount(ctx);
    assert.equal(initializeModel.mock.calls.length, 0);
    assert.equal(view.result.current[0].state, "idle");
    setGpu(false, true);
    view.rerender();
    await flush();
    assert.deepEqual(initializeModel.mock.calls, [[MODEL]]);
    assert.equal(view.result.current[0].state, "model_downloading");
    assert.equal(view.result.current[0].localUnsupportedNotice, undefined);
  });

  it("f. detection loading then false: never starts, notice raised, nothing to cancel", async () => {
    remember({ rememberChoice: true });
    const { ctx, initializeModel, cancelDownload } = makeContext(
      "unavailable",
      false,
    );
    const view = await mount(ctx);
    assert.equal(initializeModel.mock.calls.length, 0);
    assert.equal(view.result.current[0].localUnsupportedNotice, undefined);
    setGpu(false, false);
    view.rerender();
    await flush();
    assert.equal(initializeModel.mock.calls.length, 0);
    assert.equal(cancelDownload.mock.calls.length, 0);
    assert.equal(view.result.current[0].state, "idle");
    assert.equal(view.result.current[0].localUnsupportedNotice, true);
  });
});

describe("remembered-model auto-resume: unchanged paths (#766 pins)", () => {
  it("d1. detection true, rememberChoice, not cached: one initializeModel, model_downloading", async () => {
    setGpu(false, true);
    remember({ rememberChoice: true });
    const { ctx, initializeModel } = makeContext("unavailable", false);
    const view = await mount(ctx);
    assert.deepEqual(initializeModel.mock.calls, [[MODEL]]);
    assert.equal(view.result.current[0].state, "model_downloading");
    assert.equal(view.result.current[0].selectedModelId, MODEL);
    assert.equal(view.result.current[0].generationProgress, 0);
    assert.equal(view.result.current[0].localUnsupportedNotice, undefined);
    view.rerender();
    await flush();
    assert.equal(initializeModel.mock.calls.length, 1);
  });

  it("d2. detection true, rememberChoice, cached: one initializeModel, generating and ready", async () => {
    setGpu(false, true);
    remember({ rememberChoice: true });
    const { ctx, initializeModel } = makeContext("unavailable", true);
    const { result } = await mount(ctx);
    assert.deepEqual(initializeModel.mock.calls, [[MODEL]]);
    assert.equal(result.current[0].state, "generating");
    assert.equal(result.current[0].isModelReady, true);
    assert.equal(result.current[0].selectedModelId, MODEL);
  });

  it("d3. detection true, autoLoadEnabled, cached: one initializeModel, stays idle", async () => {
    setGpu(false, true);
    remember({ autoLoadEnabled: true });
    const { ctx, initializeModel } = makeContext("unavailable", true);
    const { result } = await mount(ctx);
    assert.deepEqual(initializeModel.mock.calls, [[MODEL]]);
    assert.equal(result.current[0].state, "idle");
    assert.equal(result.current[0].selectedModelId, MODEL);
  });

  it("d4. detection true, autoLoad off, cached: no initializeModel, model selected", async () => {
    setGpu(false, true);
    remember({});
    const { ctx, initializeModel } = makeContext("unavailable", true);
    const { result } = await mount(ctx);
    assert.equal(initializeModel.mock.calls.length, 0);
    assert.equal(result.current[0].selectedModelId, MODEL);
    assert.equal(result.current[0].state, "idle");
  });

  it("d5. detection true, autoLoadEnabled, not cached: no initializeModel", async () => {
    setGpu(false, true);
    remember({ autoLoadEnabled: true });
    const { ctx, initializeModel } = makeContext("unavailable", false);
    const { result } = await mount(ctx);
    assert.equal(initializeModel.mock.calls.length, 0);
    assert.equal(result.current[0].selectedModelId, undefined);
  });

  it("g1. server key present, detection false: no initializeModel and no notice", async () => {
    mockHasServerLLMAccessKey.mockReturnValue(true);
    setGpu(false, false);
    remember({ rememberChoice: true });
    const { ctx, initializeModel, hasModelInCache } = makeContext(
      "unavailable",
      true,
    );
    const { result } = await mount(ctx);
    assert.equal(initializeModel.mock.calls.length, 0);
    assert.equal(hasModelInCache.mock.calls.length, 0);
    assert.equal(result.current[0].state, "idle");
    assert.equal(result.current[0].localUnsupportedNotice, undefined);
  });

  it("g2. server key present, detection true: no initializeModel", async () => {
    mockHasServerLLMAccessKey.mockReturnValue(true);
    setGpu(false, true);
    remember({ rememberChoice: true });
    const { ctx, initializeModel } = makeContext("unavailable", false);
    const { result } = await mount(ctx);
    assert.equal(initializeModel.mock.calls.length, 0);
    assert.equal(result.current[0].state, "idle");
  });

  it("i. detection false with no remembered model: no notice", async () => {
    setGpu(false, false);
    const { ctx, initializeModel } = makeContext("unavailable", false);
    const { result } = await mount(ctx);
    assert.equal(initializeModel.mock.calls.length, 0);
    assert.equal(result.current[0].state, "idle");
    assert.equal(result.current[0].localUnsupportedNotice, undefined);
  });
});
