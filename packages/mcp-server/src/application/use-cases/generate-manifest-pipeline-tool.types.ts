import type { PipelineGenerationResponse } from "../ports/out/manifest-generation.port.js";

export interface GenerateManifestPipelineInput {
  description: string;
  maxRetries?: number;
  dryRun?: boolean;
  signal?: AbortSignal;
}

export type GenerateManifestPipelineOutput = PipelineGenerationResponse;
