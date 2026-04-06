import type { ArchitectureGraph } from "@hexagen/shared";
import type { GetGraphResourceUseCase } from "../../application/use-cases/get-graph-resource.use-case.js";

export class GraphResourceAdapter {
  constructor(private readonly useCase: GetGraphResourceUseCase) {}

  async execute(): Promise<ArchitectureGraph> {
    return this.useCase.execute();
  }
}
