import type { ArchitectureGraph } from "@hexagen/shared";
import { GetGraphResourceUseCase } from "../../application/use-cases/get-graph-resource.use-case.js";

export class GraphResourceAdapter {
  constructor(private readonly useCase: GetGraphResourceUseCase) {}

  async getGraph(): Promise<ArchitectureGraph> {
    const result = await this.useCase.execute();
    if (!result.success) {
      throw result.error;
    }
    return result.value;
  }
}
