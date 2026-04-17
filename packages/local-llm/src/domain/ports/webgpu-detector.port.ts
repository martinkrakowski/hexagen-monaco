import type { Result } from "@hexagen/shared";

export interface WebGPUCapability {
  supported: boolean;
  adapter: unknown;
  device: unknown;
  maxTextureSize: number | null;
  supportsFP16: boolean;
}

export interface WebGPUDetectorPort {
  detect(): Promise<Result<WebGPUCapability>>;
  isSupported(): boolean;
}
