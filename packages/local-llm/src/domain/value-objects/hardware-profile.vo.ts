import { type Result, ok, err } from "@hexagen/shared";

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
 * Deep-freeze a value recursively for use as a shared constant sentinel.
 */
function deepFreeze<T extends object>(value: T): Readonly<T> {
  for (const key of Object.keys(value)) {
    const prop = value[key as keyof T];
    if (prop && typeof prop === "object") {
      (value as Record<string, unknown>)[key] = deepFreeze(prop as object);
    }
  }
  return Object.freeze(value) as Readonly<T>;
}

/**
 * Factory for HardwareProfile with basic invariant validation.
 * cpuCores must be >= 1. ramMB, if provided, must be > 0.
 */
export function createHardwareProfile(
  cpuCores: number,
  ramMB: number | null,
  gpuSupported: boolean,
  gpuVendor: string | null = null,
  gpuArchitecture: string | null = null,
  gpuMaxBufferMB: number | null = null,
  deviceClass: "desktop" | "mobile" | "unknown" = "unknown",
): Result<HardwareProfile> {
  if (!Number.isInteger(cpuCores) || cpuCores < 1) {
    return err(
      new Error(`cpuCores must be a positive integer, got ${cpuCores}`),
    );
  }
  if (ramMB !== null && (ramMB <= 0 || !Number.isFinite(ramMB))) {
    return err(
      new Error(`ramMB must be a positive finite number, got ${ramMB}`),
    );
  }

  const profile: HardwareProfile = {
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

  return ok(profile);
}

/**
 * Conservative default for unknown hardware — frozen to prevent mutation.
 */
export const UNKNOWN_HARDWARE: Readonly<HardwareProfile> = deepFreeze({
  cpuCores: 4,
  ramMB: null,
  gpu: {
    supported: false,
    vendor: null,
    architecture: null,
    maxBufferMB: null,
  },
  deviceClass: "unknown",
});
