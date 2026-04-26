import type { Result } from "@hexagen/shared";
import type { Manifest } from "../../../domain/model/manifest-schema/manifest-schema";

export interface ProjectConfigurationReadPort {
  /**
   * Reads and validates the current manifest
   */
  getManifest(): Promise<Result<Manifest>>;
}
