import type { PipelineGenerationResponse } from "../out/manifest-generation.port.js";

/**
 * Inbound (driving) port per ADR-0048: the use case implements this contract
 * and the MCP tool adapter calls it. Nothing in `infrastructure/` implements it.
 *
 * The driven collaborator is `ManifestGenerationPort` — constructor-injected
 * into the use case and implemented by the OpenAI adapter. That contract stays
 * outbound and is not re-declared here. The output type aliases the outbound
 * response because this tool forwards it 1:1; the input is declared on this
 * side so the inbound contract does not extend the outbound request.
 */
export interface GenerateManifestPipelineInput {
  description: string;
  maxRetries?: number;
  dryRun?: boolean;
  signal?: AbortSignal;
}

export type GenerateManifestPipelineOutput = PipelineGenerationResponse;

export interface GenerateManifestPipelineToolPort {
  execute(
    input: GenerateManifestPipelineInput,
  ): Promise<GenerateManifestPipelineOutput>;
}
