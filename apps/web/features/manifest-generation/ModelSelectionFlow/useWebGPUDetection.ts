"use client";

import { useEffect, useState } from "react";
import { getWebGPUDetector, getHardwareProfiler } from "../../../app/lib/wire";
import type { GraphicsCapability } from "@hexagen/local-llm";

export interface GPUDetectionResult {
  /**
   * Whether WebGPU is fully supported by the browser
   */
  isWebGPUSupported: boolean;

  /**
   * Whether the browser itself supports the WebGPU API
   * (navigator.gpu exists but may not have a compatible adapter)
   */
  isBrowserSupported: boolean;

  /**
   * Whether the hardware has adequate GPU for model execution
   * (based on available VRAM and other constraints)
   */
  isHardwareAdequate: boolean;

  /**
   * Estimated VRAM in MB (if available)
   */
  estimatedVRAM: number | null;

  /**
   * Whether this device is likely to provide a good experience
   * running local models (combination of hardware factors)
   */
  isRecommended: boolean;

  /**
   * Detailed WebGPU capability information
   */
  capability: GraphicsCapability | null;

  /**
   * Loading state
   */
  isLoading: boolean;
}

/**
 * Hook for detecting WebGPU compatibility and hardware capabilities
 * Integrates with the existing GraphicsCapabilityPort and HardwareProfilerPort
 */
export function useWebGPUDetection(): GPUDetectionResult {
  const [result, setResult] = useState<GPUDetectionResult>({
    isWebGPUSupported: false,
    isBrowserSupported: false,
    isHardwareAdequate: false,
    estimatedVRAM: null,
    isRecommended: false,
    capability: null,
    isLoading: true,
  });

  useEffect(() => {
    const webGPUDetector = getWebGPUDetector();
    const hardwareProfiler = getHardwareProfiler();

    // Simple browser API detection (fast, synchronous)
    const hasWebGPUAPI = webGPUDetector.isSupported();

    Promise.all([webGPUDetector.detect(), hardwareProfiler.profile()])
      .then(([gpuResult, hwResult]) => {
        // Default values if either request fails
        let webGPUSupported = false;
        let browserSupported = hasWebGPUAPI;
        let hardwareAdequate = false;
        let estimatedVRAM = null;
        let capability = null;

        // Process WebGPU detection result
        if (gpuResult.success) {
          capability = gpuResult.value;
          webGPUSupported = capability.supported;

          // If WebGPU is supported but browser lacks OffscreenCanvas,
          // mark as hardware supported but browser limited
          if (webGPUSupported && typeof OffscreenCanvas === "undefined") {
            webGPUSupported = false;
            browserSupported = false;
          }
        }

        // Process hardware profile result
        if (hwResult.success) {
          const profile = hwResult.value;

          // Extract estimated VRAM
          estimatedVRAM = profile.gpu.maxBufferMB;

          // Determine if hardware is adequate for running models
          // (min 2GB VRAM for smallest models, ideally 4+ GB)
          if (estimatedVRAM && estimatedVRAM >= 2048) {
            hardwareAdequate = true;
          } else if (profile.deviceClass === "desktop" && webGPUSupported) {
            // If we couldn't detect VRAM but it's a desktop with WebGPU,
            // assume it's adequate as a fallback
            hardwareAdequate = true;
          }

          // Is this a recommended configuration?
          // (desktop with 4+ CPU cores, 8+ GB RAM, adequate GPU)
          const isRecommended =
            profile.deviceClass === "desktop" &&
            profile.cpuCores >= 4 &&
            (profile.ramMB ? profile.ramMB >= 8192 : true) &&
            hardwareAdequate;

          setResult({
            isWebGPUSupported: webGPUSupported,
            isBrowserSupported: browserSupported,
            isHardwareAdequate: hardwareAdequate,
            estimatedVRAM,
            isRecommended,
            capability,
            isLoading: false,
          });
        } else {
          // Hardware profiler failed, use WebGPU detection only
          setResult({
            isWebGPUSupported: webGPUSupported,
            isBrowserSupported: browserSupported,
            isHardwareAdequate: webGPUSupported, // Assume adequate if WebGPU works
            estimatedVRAM,
            isRecommended: webGPUSupported,
            capability,
            isLoading: false,
          });
        }
      })
      .catch(() => {
        // Both detection mechanisms failed
        setResult({
          isWebGPUSupported: false,
          isBrowserSupported: hasWebGPUAPI,
          isHardwareAdequate: false,
          estimatedVRAM: null,
          isRecommended: false,
          capability: null,
          isLoading: false,
        });
      });
  }, []);

  return result;
}
