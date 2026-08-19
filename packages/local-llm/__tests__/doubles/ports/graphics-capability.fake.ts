import { ok, type Result } from "@hexagen/shared";
import type { GraphicsCapabilityPort } from "../../../src/domain/ports/index.js";
import type { GraphicsCapability } from "../../../src/domain/ports/index.js";

export type FakeGraphicsCapabilityConfig = {
  supported?: boolean;
  maxTextureSize?: number | null;
  supportsFP16?: boolean;
  detectError?: Error;
};

/**
 * FakeGraphicsCapabilityPort: Test double for graphics capability detection
 *
 * Allows tests to control detection results without hitting browser APIs
 */
export class FakeGraphicsCapabilityPort implements GraphicsCapabilityPort {
  private config: FakeGraphicsCapabilityConfig;

  constructor(config: FakeGraphicsCapabilityConfig = {}) {
    this.config = config;
  }

  async detect(): Promise<Result<GraphicsCapability>> {
    if (this.config.detectError) {
      return {
        success: false,
        error: this.config.detectError,
      };
    }

    const capability: GraphicsCapability = {
      supported: this.config.supported ?? true,
      maxTextureSize: this.config.maxTextureSize ?? 2048,
      supportsFP16: this.config.supportsFP16 ?? true,
    };

    return ok(capability);
  }

  isSupported(): boolean {
    return this.config.supported ?? true;
  }
}
