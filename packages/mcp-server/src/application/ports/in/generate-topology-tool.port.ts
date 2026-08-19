import type { TopologyGenerationResponse } from "../out/manifest-generation.port.js";

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
export interface GenerateTopologyInput {
  description: string;
  maxRetries?: number;
}

export type GenerateTopologyOutput = TopologyGenerationResponse;

export interface GenerateTopologyToolPort {
  execute(input: GenerateTopologyInput): Promise<GenerateTopologyOutput>;
}
