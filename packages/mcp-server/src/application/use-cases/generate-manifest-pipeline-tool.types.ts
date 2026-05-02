import type { PipelineGenerationResponse } from "../ports/out/manifest-generation.port.js";

export interface GenerateManifestPipelineInput {
  description: string;
  maxRetries?: number;
  dryRun?: boolean;
}

export type GenerateManifestPipelineOutput = PipelineGenerationResponse;
