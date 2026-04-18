/**
 * HardwareProfile: Browser hardware capabilities and constraints
 *
 * Represents the user's device capabilities for hardware-aware
 * model recommendation. Includes CPU, RAM, GPU, and device class.
 */

export interface HardwareProfile {
  /** Number of logical CPU cores available to the browser */
  cpuCores: number;

  /** System RAM in MB. null if browser doesn't expose it (Safari, Firefox) */
  ramMB: number | null;

  /** GPU/WebGPU capabilities */
  gpu: {
    /** Is WebGPU supported on this browser/device? */
    supported: boolean;

    /** GPU vendor string (e.g., "apple", "nvidia", "intel") */
    vendor: string | null;

    /** GPU architecture name (e.g., "Apple GPU", "common-3") */
    architecture: string | null;

    /** Max single buffer allocation in MB. null if not available */
    maxBufferMB: number | null;
  };

  /** Device classification based on screen size and capabilities */
  deviceClass: "desktop" | "mobile" | "unknown";
}

/**
 * Factory for HardwareProfile — defaults all null/unknown fields
 */
export function createHardwareProfile(
  cpuCores: number,
  ramMB: number | null,
  gpuSupported: boolean,
  gpuVendor: string | null = null,
  gpuArchitecture: string | null = null,
  gpuMaxBufferMB: number | null = null,
  deviceClass: "desktop" | "mobile" | "unknown" = "unknown",
): HardwareProfile {
  return {
    cpuCores,
    ramMB,
    gpu: {
      supported: gpuSupported,
      vendor: gpuVendor,
      architecture: gpuArchitecture,
      maxBufferMB: gpuMaxBufferMB,
    },
    deviceClass,
  };
}

/**
 * Conservative default for unknown hardware
 */
export const UNKNOWN_HARDWARE: HardwareProfile = {
  cpuCores: 4,
  ramMB: null,
  gpu: {
    supported: false,
    vendor: null,
    architecture: null,
    maxBufferMB: null,
  },
  deviceClass: "unknown",
};
