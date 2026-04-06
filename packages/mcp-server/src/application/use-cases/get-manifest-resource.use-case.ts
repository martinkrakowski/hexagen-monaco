import type { Manifest } from "@hexagen/shared";
import type { ProjectConfigurationReadPort } from "../ports/out/project-configuration-read.port.js";

export class GetManifestResourceUseCase {
  constructor(
    private readonly projectConfigurationReadPort: ProjectConfigurationReadPort,
  ) {}

  async execute(): Promise<Manifest> {
    const result = await this.projectConfigurationReadPort.getManifest();
    if (!result.success) {
      throw result.error;
    }

    return result.value;
  }
}
