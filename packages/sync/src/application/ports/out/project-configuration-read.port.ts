import type { Result } from "@hexagen/shared";
import type { Manifest } from "@hexagen/shared";

export interface ProjectConfigurationReadPort {
  /**
   * Reads and validates the current manifest
   */
  getManifest(): Promise<Result<Manifest>>;
}
