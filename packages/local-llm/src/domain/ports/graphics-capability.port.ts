import type { Result } from "@hexagen/shared";

/**
 * Graphics acceleration capability flags.
 * Boolean and limit fields only — no vendor GPU handles.
 */
export interface GraphicsCapability {
  supported: boolean;
  maxTextureSize: number | null;
  supportsFP16: boolean;
}

/**
 * Detects whether the current device can accelerate local inference.
 * Detection mechanism is an adapter concern.
 */
export interface GraphicsCapabilityPort {
  detect(): Promise<Result<GraphicsCapability>>;
  isSupported(): boolean;
}
