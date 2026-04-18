import type { Result } from "@hexagen/shared";
import type { HardwareProfilerPort } from "../../domain/ports/index.js";
import type { HardwareProfile } from "../../domain/value-objects/hardware-profile.vo.js";
import { createHardwareProfile } from "../../domain/value-objects/hardware-profile.vo.js";

/**
 * BrowserHardwareProfilerAdapter: Detects browser hardware capabilities
 *
 * Reads navigator APIs to determine:
 * - CPU cores (navigator.hardwareConcurrency)
 * - System RAM (navigator.deviceMemory)
 * - GPU capability (navigator.gpu.requestAdapter())
 * - Device class (desktop vs mobile)
 *
 * Note: This adapter does NOT call requestDevice() — only requestAdapter().
 * Device creation happens elsewhere (WebGPUCapabilityAdapter). This keeps
 * resource allocation separate from capability detection.
 */
export class BrowserHardwareProfilerAdapter implements HardwareProfilerPort {
  async profile(): Promise<Result<HardwareProfile>> {
    try {
      // 1. CPU cores
      const cpuCores = this.detectCpuCores();

      // 2. System RAM (MB)
      const ramMB = this.detectSystemRam();

      // 3. Device class (desktop vs mobile)
      const deviceClass = this.detectDeviceClass();

      // 4. GPU capabilities
      const gpuInfo = await this.detectGpu();

      const profile = createHardwareProfile(
        cpuCores,
        ramMB,
        gpuInfo.supported,
        gpuInfo.vendor,
        gpuInfo.architecture,
        gpuInfo.maxBufferMB,
        deviceClass,
      );

      return {
        success: true,
        value: profile,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  private detectCpuCores(): number {
    if (typeof navigator === "undefined") {
      return 4; // Safe default
    }

    const cores = navigator.hardwareConcurrency;
    return cores && cores > 0 ? cores : 4;
  }

  private detectSystemRam(): number | null {
    if (typeof navigator === "undefined") {
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deviceMemoryGB = (navigator as any).deviceMemory;
    if (deviceMemoryGB && deviceMemoryGB > 0) {
      return Math.round(deviceMemoryGB * 1024); // Convert GB to MB
    }

    return null; // Unknown (Safari, Firefox don't expose this)
  }

  private detectDeviceClass(): "desktop" | "mobile" | "unknown" {
    if (typeof window === "undefined") {
      return "unknown";
    }

    // Simple heuristic: if screen width < 768px, likely mobile
    if (window.innerWidth < 768) {
      return "mobile";
    }

    // Additional check: if touch is the primary input method
    const maxTouchPoints =
      typeof navigator !== "undefined"
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (navigator as any).maxTouchPoints
        : 0;
    if (maxTouchPoints && maxTouchPoints > 0 && window.innerWidth < 1024) {
      return "mobile";
    }

    return "desktop";
  }

  private async detectGpu(): Promise<{
    supported: boolean;
    vendor: string | null;
    architecture: string | null;
    maxBufferMB: number | null;
  }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof navigator === "undefined" || !(navigator as any).gpu) {
      return {
        supported: false,
        vendor: null,
        architecture: null,
        maxBufferMB: null,
      };
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const adapter = await (navigator as any).gpu.requestAdapter({
        powerPreference: "high-performance",
      });

      if (!adapter) {
        return {
          supported: false,
          vendor: null,
          architecture: null,
          maxBufferMB: null,
        };
      }

      // Read adapter limits (don't create a device)
      const maxBufferSize = adapter.limits?.maxBufferSize;
      const maxBufferMB = maxBufferSize
        ? Math.round(maxBufferSize / 1024 / 1024)
        : null;

      // Try to extract vendor and architecture from adapter info
      // Note: requestAdapterInfo() is async and may not be available on all browsers
      let vendor: string | null = null;
      let architecture: string | null = null;

      // Fallback: check if adapter has info property (older WebGPU versions)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((adapter as any).info) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const info = (adapter as any).info;
        vendor = info.vendor || null;
        architecture = info.architecture || null;
      }

      // Try the newer async API if available
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (typeof (adapter as any).requestAdapterInfo === "function") {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const info = await (adapter as any).requestAdapterInfo();
          vendor = info?.vendor || vendor;
          architecture = info?.architecture || architecture;
        } catch {
          // Silently continue with sync-detected values
        }
      }

      return {
        supported: true,
        vendor,
        architecture,
        maxBufferMB,
      };
    } catch {
      // If requestAdapter throws, WebGPU is unavailable or errored
      return {
        supported: false,
        vendor: null,
        architecture: null,
        maxBufferMB: null,
      };
    }
  }
}
