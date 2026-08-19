import type {
  GenerateManifestPipelineInput,
  GenerateManifestPipelineOutput,
  GenerateManifestPipelineToolPort,
} from "../ports/in/generate-manifest-pipeline-tool.port.js";
import type { ManifestGenerationPort } from "../ports/out/manifest-generation.port.js";

export class GenerateManifestPipelineToolUseCase implements GenerateManifestPipelineToolPort {
  constructor(private readonly port: ManifestGenerationPort) {}

  async execute(
    input: GenerateManifestPipelineInput,
  ): Promise<GenerateManifestPipelineOutput> {
    if (!input.description.trim()) {
      throw new Error("description is required");
    }

    return this.port.generateManifestPipeline({
      description: input.description,
      maxRetries: input.maxRetries,
      dryRun: input.dryRun,
      signal: input.signal,
    });
  }
}
