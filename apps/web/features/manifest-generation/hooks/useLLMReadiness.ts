"use client";

import {
  hasServerLLMAccessKey,
  isLocalLLMReady,
} from "../../../app/lib/wire.client";
import { useWebGPUDetection } from "../ModelSelectionFlow/useWebGPUDetection";
import { useCapabilityProbe } from "./useCapabilityProbe";

export interface LLMReadiness {
  hasAnyCloud: boolean;
  hasWebLLMHardware: boolean;
  isWebLLMReady: boolean;
  isLoading: boolean;
  isProbing: boolean;
  needsSetup: boolean;
  preferLocal: boolean;
}

interface EngineStateSnapshot {
  status: string;
  autoLoading?: boolean;
}

export function useLLMReadiness(
  engineState?: EngineStateSnapshot,
): LLMReadiness {
  const hasServerApiKey = hasServerLLMAccessKey();
  const gpuDetection = useWebGPUDetection();
  const capabilities = useCapabilityProbe(hasServerApiKey);

  const hasAnyCloud = hasServerApiKey || (capabilities?.canGenerate ?? false);
  const hasWebLLMHardware =
    gpuDetection.isWebGPUSupported && gpuDetection.isHardwareAdequate;

  const isWebLLMReady = engineState
    ? engineState.status === "ready"
    : isLocalLLMReady();

  const isLoading = engineState
    ? engineState.status === "downloading" ||
      (engineState.status === "loading_vram" && !engineState.autoLoading)
    : false;

  // True while the async BYOK probe is still in-flight with no fast-pass.
  // Guards against a "no model" flash before capabilities resolve.
  const isProbing = capabilities === null && !hasServerApiKey;

  const needsSetup = !hasAnyCloud && !hasWebLLMHardware;
  const preferLocal = !hasAnyCloud && hasWebLLMHardware;

  return {
    hasAnyCloud,
    hasWebLLMHardware,
    isWebLLMReady,
    isLoading,
    isProbing,
    needsSetup,
    preferLocal,
  };
}
