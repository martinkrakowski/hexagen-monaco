import type { TopologyGenerationResponse } from "../ports/out/manifest-generation.port.js";

export interface GenerateTopologyInput {
  description: string;
  maxRetries?: number;
}

export type GenerateTopologyOutput = TopologyGenerationResponse;
