import type { Manifest } from "@hexagen/shared";
import type { GetManifestResourceUseCase } from "../../application/use-cases/get-manifest-resource.use-case.js";

export class ManifestResourceAdapter {
  constructor(private readonly useCase: GetManifestResourceUseCase) {}

  async execute(): Promise<Manifest> {
    return this.useCase.execute();
  }
}
