import type { Result } from "@hexagen/shared";
import type {
  WebGPUCapability,
  WebGPUDetectorPort,
} from "../../domain/ports/index.js";

declare global {
  interface Navigator {
    gpu?: GPU;
  }

  interface GPU {
    requestAdapter(
      options?: GPURequestAdapterOptions,
    ): Promise<GPUAdapter | null>;
  }

  interface GPUAdapter {
    requestDevice(): Promise<GPUDevice>;
    features: Iterable<GPUFeatureName>;
  }

  interface GPUDevice extends GPUAdapter {
    limits: { maxTextureDimension2D: number };
  }

  interface GPURequestAdapterOptions {
    powerPreference?: "default" | "high-performance" | "low-power";
  }

  type GPUFeatureName = "shader-fp16" | string;
}

export class WebGPUCapabilityAdapter implements WebGPUDetectorPort {
  async detect(): Promise<Result<WebGPUCapability>> {
    try {
      if (typeof navigator === "undefined" || !navigator.gpu) {
        return {
          success: true,
          value: {
            supported: false,
            adapter: null,
            device: null,
            maxTextureSize: null,
            supportsFP16: false,
          },
        };
      }

      const adapter = await navigator.gpu.requestAdapter({
        powerPreference: "high-performance",
      });

      if (!adapter) {
        return {
          success: true,
          value: {
            supported: false,
            adapter: null,
            device: null,
            maxTextureSize: null,
            supportsFP16: false,
          },
        };
      }

      const device = await adapter.requestDevice();
      const features = Array.from(device.features);
      const supportsFP16 = features.includes("shader-fp16");

      return {
        success: true,
        value: {
          supported: true,
          adapter,
          device,
          maxTextureSize: device.limits.maxTextureDimension2D,
          supportsFP16,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  isSupported(): boolean {
    return typeof navigator !== "undefined" && navigator.gpu !== undefined;
  }
}
