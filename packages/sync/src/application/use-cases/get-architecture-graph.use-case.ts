import type { ArchitectureGraph } from "@hexagen/visualization";
import type { ArchitectureGraphProviderPort } from "../ports/out/architecture-graph-provider.port.js";

export class GetArchitectureGraphUseCase {
  constructor(private readonly provider: ArchitectureGraphProviderPort) {}

  async execute(projectId: string): Promise<ArchitectureGraph> {
    const result = await this.provider.getArchitectureGraph(projectId);
    if (!result.success) {
      throw result.error;
    }

    // No re-validation here by design (ADR-0054 zod disposition, 2026-08-16):
    // `ArchitectureGraphProviderPort` is an in-process port and every
    // implementation builds the graph in TypeScript from an already-parsed
    // manifest. The untrusted-input boundary is the manifest parser in
    // `@hexagen/project-configuration`, which still validates; re-parsing here
    // only re-checked what the type system already guarantees.
    return result.value;
  }
}
