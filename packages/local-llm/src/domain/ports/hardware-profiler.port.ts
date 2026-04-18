import type { Result } from "@hexagen/shared";
import type { HardwareProfile } from "../value-objects/hardware-profile.vo.js";

/**
 * HardwareProfilerPort: Browser hardware capability detection
 *
 * This port abstracts hardware detection (CPU, RAM, GPU) so
 * the domain can remain independent of browser APIs.
 */
export interface HardwareProfilerPort {
  /**
   * Detect browser and device hardware capabilities
   * Returns a HardwareProfile with CPU, RAM, and GPU information
   */
  profile(): Promise<Result<HardwareProfile>>;
}
