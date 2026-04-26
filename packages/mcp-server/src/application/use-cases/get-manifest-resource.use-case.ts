import type { Manifest } from "@hexagen/project-configuration";
import type { Result } from "@hexagen/shared";
import type { ProjectConfigurationReadPort } from "../ports/out/project-configuration-read.port.js";

export class GetManifestResourceUseCase {
  constructor(
    private readonly projectConfigurationReadPort: ProjectConfigurationReadPort,
  ) {}

  async execute(): Promise<Result<Manifest>> {
    return this.projectConfigurationReadPort.getManifest();
  }
}
