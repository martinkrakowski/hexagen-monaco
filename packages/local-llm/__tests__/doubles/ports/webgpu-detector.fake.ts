import { ok, type Result } from "@hexagen/shared";
import type { WebGPUDetectorPort } from "../../../src/domain/ports/index.js";
import type { WebGPUCapability } from "../../../src/domain/ports/index.js";

export type FakeWebGPUDetectorConfig = {
  supported?: boolean;
  adapter?: unknown;
  device?: unknown;
  maxTextureSize?: number | null;
  supportsFP16?: boolean;
  detectError?: Error;
};

/**
 * FakeWebGPUDetectorPort: Test double for WebGPU capability detection
 *
 * Allows tests to control WebGPU detection results without hitting browser APIs
 */
export class FakeWebGPUDetectorPort implements WebGPUDetectorPort {
  private config: FakeWebGPUDetectorConfig;

  constructor(config: FakeWebGPUDetectorConfig = {}) {
    this.config = config;
  }

  async detect(): Promise<Result<WebGPUCapability>> {
    if (this.config.detectError) {
      return {
        success: false,
        error: this.config.detectError,
      };
    }

    const capability: WebGPUCapability = {
      supported: this.config.supported ?? true,
      adapter: this.config.adapter ?? null,
      device: this.config.device ?? null,
      maxTextureSize: this.config.maxTextureSize ?? 2048,
      supportsFP16: this.config.supportsFP16 ?? true,
    };

    return ok(capability);
  }

  isSupported(): boolean {
    return this.config.supported ?? true;
  }
}
