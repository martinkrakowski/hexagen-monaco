export interface TopologyGenerationRequest {
  description: string;
  maxRetries?: number;
}

export interface AdapterGenerationRequest {
  contextName: string;
  portNames: string[];
  maxRetries?: number;
}

export interface PipelineGenerationRequest {
  description: string;
  maxRetries?: number;
  dryRun?: boolean;
  signal?: AbortSignal;
}

export interface TopologyGenerationResponse {
  topology: {
    workspace: { name: string; description: string };
    boundedContexts: Array<{
      name: string;
      type: "core" | "supporting" | "driver" | "shared-kernel";
      description: string;
      ports: {
        in: Array<{ name: string; type: string; description: string }>;
        out: Array<{ name: string; type: string; description: string }>;
      };
      dependsOn?: string[];
    }>;
  };
  clarificationTriggers: Array<{
    type: string;
    contextName?: string;
    message: string;
  }>;
}

export interface AdapterGenerationResponse {
  adapters: Array<{ name: string; type: string; implements: string }>;
}

export interface PipelineGenerationResponse {
  dryRun: boolean;
  yaml: string;
  contextCount: number;
  totalPorts: number;
  totalAdapters: number;
  diagnostics: Array<{ code: string; message: string; path?: string }>;
  registeredInManifest: boolean;
}

export interface ManifestGenerationPort {
  generateTopology(
    request: TopologyGenerationRequest,
    signal?: AbortSignal,
  ): Promise<TopologyGenerationResponse>;
  generateAdapters(
    request: AdapterGenerationRequest,
    signal?: AbortSignal,
  ): Promise<AdapterGenerationResponse>;
  generateManifestPipeline(
    request: PipelineGenerationRequest,
  ): Promise<PipelineGenerationResponse>;
}
