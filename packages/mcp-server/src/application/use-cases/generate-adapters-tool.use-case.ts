import type {
  GenerateAdaptersInput,
  GenerateAdaptersOutput,
  GenerateAdaptersToolPort,
} from "../ports/in/generate-adapters-tool.port.js";
import type { ManifestGenerationPort } from "../ports/out/manifest-generation.port.js";

export class GenerateAdaptersToolUseCase implements GenerateAdaptersToolPort {
  constructor(private readonly port: ManifestGenerationPort) {}

  async execute(input: GenerateAdaptersInput): Promise<GenerateAdaptersOutput> {
    if (!input.contextName.trim()) {
      throw new Error("contextName is required");
    }
    if (input.portNames.length === 0) {
      return { adapters: [] };
    }

    return this.port.generateAdapters({
      contextName: input.contextName,
      portNames: input.portNames,
      maxRetries: input.maxRetries,
    });
  }
}
