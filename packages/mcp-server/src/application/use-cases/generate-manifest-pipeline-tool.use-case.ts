import type { ManifestGenerationPort } from "../ports/out/manifest-generation.port.js";
import type {
  GenerateManifestPipelineInput,
  GenerateManifestPipelineOutput,
} from "./generate-manifest-pipeline-tool.types.js";

export class GenerateManifestPipelineToolUseCase {
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
    });
  }
}
