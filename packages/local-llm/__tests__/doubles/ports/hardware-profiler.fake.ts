import { ok, type Result } from "@hexagen/shared";
import type { HardwareProfilerPort } from "../../../src/domain/ports/index.js";
import type { HardwareProfile } from "../../../src/domain/value-objects/hardware-profile.vo.js";
import { createHardwareProfile } from "../../../src/domain/value-objects/hardware-profile.vo.js";

export type FakeHardwareProfilerConfig = {
  cpuCores?: number;
  ramMB?: number | null;
  gpuSupported?: boolean;
  gpuVendor?: string | null;
  gpuArchitecture?: string | null;
  gpuMaxBufferMB?: number | null;
  deviceClass?: "desktop" | "mobile" | "unknown";
  profileError?: Error;
};

/**
 * FakeHardwareProfilerPort: Test double for hardware detection
 *
 * Allows tests to specify hardware capabilities without hitting browser APIs
 */
export class FakeHardwareProfilerPort implements HardwareProfilerPort {
  private config: FakeHardwareProfilerConfig;

  constructor(config: FakeHardwareProfilerConfig = {}) {
    this.config = config;
  }

  async profile(): Promise<Result<HardwareProfile>> {
    if (this.config.profileError) {
      return {
        success: false,
        error: this.config.profileError,
      };
    }

    const profile = createHardwareProfile(
      this.config.cpuCores ?? 8,
      this.config.ramMB ?? 16 * 1024,
      this.config.gpuSupported ?? true,
      this.config.gpuVendor ?? "test-vendor",
      this.config.gpuArchitecture ?? "test-architecture",
      this.config.gpuMaxBufferMB ?? 4096,
      this.config.deviceClass ?? "desktop",
    );

    return ok(profile);
  }
}
