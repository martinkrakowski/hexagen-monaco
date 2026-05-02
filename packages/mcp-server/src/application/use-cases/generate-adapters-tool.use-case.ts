import type { ManifestGenerationPort } from "../ports/out/manifest-generation.port.js";
import type {
  GenerateAdaptersInput,
  GenerateAdaptersOutput,
} from "./generate-adapters-tool.types.js";

export class GenerateAdaptersToolUseCase {
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
