import type { Manifest } from "@hexagen/project-configuration";
import { GetManifestResourceUseCase } from "../../application/use-cases/get-manifest-resource.use-case.js";

export class ManifestResourceAdapter {
  constructor(private readonly useCase: GetManifestResourceUseCase) {}

  async getManifest(): Promise<Manifest> {
    const result = await this.useCase.execute();
    if (!result.success) {
      throw result.error;
    }
    return result.value;
  }
}
