import type { ProjectConfigurationReadPort } from "../ports/out/project-configuration-read.port.js";
import { ManifestSchema, type Manifest } from "@hexagen/project-configuration";

export class GetManifestResourceUseCase {
  constructor(private readonly projectConfig: ProjectConfigurationReadPort) {}

  async execute(): Promise<Manifest> {
    const result = await this.projectConfig.getManifest();
    if (!result.success) {
      throw result.error;
    }
    return ManifestSchema.parse(result.value);
  }
}
