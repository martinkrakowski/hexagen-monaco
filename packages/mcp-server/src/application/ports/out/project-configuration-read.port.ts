import type { Manifest } from "@hexagen/project-configuration";
import type { Result } from "@hexagen/shared";

export interface ProjectConfigurationReadPort {
  getManifest(): Promise<Result<Manifest>>;
}
