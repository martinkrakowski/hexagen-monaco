import type { Manifest, Result } from "@hexagen/shared";

export interface ProjectConfigurationReadPort {
  getManifest(): Promise<Result<Manifest>>;
}
