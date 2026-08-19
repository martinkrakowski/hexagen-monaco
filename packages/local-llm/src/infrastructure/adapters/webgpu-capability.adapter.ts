import type { Result } from "@hexagen/shared";
import type {
  GraphicsCapability,
  GraphicsCapabilityPort,
} from "../../domain/ports/index.js";

interface GPU {
  requestAdapter(
    options?: GPURequestAdapterOptions,
  ): Promise<GPUAdapter | null>;
}

interface GPUAdapter {
  requestDevice(): Promise<GPUDevice>;
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
  powerPreference?: "high-performance" | "low-power";
}

interface NavigatorWithGPU {
  gpu?: GPU;
}

export class WebGPUCapabilityAdapter implements GraphicsCapabilityPort {
  async detect(): Promise<Result<GraphicsCapability>> {
    try {
      // Check typeof on the raw identifier BEFORE any cast.
      // typeof returns "undefined" for undeclared vars without throwing.
      // Casting undeclared navigator to a typed variable would throw first.
      if (
        typeof navigator === "undefined" ||
        !(navigator as NavigatorWithGPU).gpu
      ) {
        return {
          success: true,
          value: {
            supported: false,
            maxTextureSize: null,
            supportsFP16: false,
          },
        };
      }

      const adapter = await (navigator as NavigatorWithGPU).gpu!.requestAdapter(
        {
          powerPreference: "high-performance",
        },
      );

      if (!adapter) {
        return {
          success: true,
          value: {
            supported: false,
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
    return (
      typeof navigator !== "undefined" &&
      (navigator as NavigatorWithGPU).gpu !== undefined
    );
  }
}
