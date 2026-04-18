import type { Result } from "@hexagen/shared";
import type {
  WebGPUCapability,
  WebGPUDetectorPort,
} from "../../domain/ports/index.js";

interface GPU {
  requestAdapter(
    options?: GPURequestAdapterOptions,
  ): Promise<GPUAdapter | null>;
}

interface GPUAdapter {
  requestDevice(): GPUDevice;
  features: Iterable<string>;
}

interface GPUDevice {
  features: Iterable<string>;
  limits: {
    maxTextureDimension2D: number;
    maxBufferSize: number;
  };
}

interface GPURequestAdapterOptions {
  powerPreference?: "default" | "high-performance" | "low-power";
}

interface NavigatorWithGPU {
  gpu?: GPU;
}

export class WebGPUCapabilityAdapter implements WebGPUDetectorPort {
  async detect(): Promise<Result<WebGPUCapability>> {
    try {
      const nav = navigator as NavigatorWithGPU;
      if (typeof nav === "undefined" || !nav.gpu) {
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

      const adapter = await nav.gpu.requestAdapter({
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

      const adapterFeatures = Array.from(adapter.features);
      const supportsFP16 = adapterFeatures.includes("shader-fp16");

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
    const nav = navigator as NavigatorWithGPU;
    return typeof nav !== "undefined" && nav.gpu !== undefined;
  }
}
