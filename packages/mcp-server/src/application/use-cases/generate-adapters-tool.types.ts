import type { AdapterGenerationResponse } from "../ports/out/manifest-generation.port.js";

export interface GenerateAdaptersInput {
  contextName: string;
  portNames: string[];
  maxRetries?: number;
}

export type GenerateAdaptersOutput = AdapterGenerationResponse;
