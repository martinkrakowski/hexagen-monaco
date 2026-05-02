import type { ManifestGenerationPort } from "../ports/out/manifest-generation.port.js";
import type {
  GenerateTopologyInput,
  GenerateTopologyOutput,
} from "./generate-topology-tool.types.js";

export class GenerateTopologyToolUseCase {
  constructor(private readonly port: ManifestGenerationPort) {}

  async execute(input: GenerateTopologyInput): Promise<GenerateTopologyOutput> {
    if (!input.description.trim()) {
      throw new Error("description is required");
    }

    return this.port.generateTopology({
      description: input.description,
      maxRetries: input.maxRetries,
    });
  }
}
