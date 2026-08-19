import type {
  GenerateTopologyInput,
  GenerateTopologyOutput,
  GenerateTopologyToolPort,
} from "../ports/in/generate-topology-tool.port.js";
import type { ManifestGenerationPort } from "../ports/out/manifest-generation.port.js";

export class GenerateTopologyToolUseCase implements GenerateTopologyToolPort {
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
