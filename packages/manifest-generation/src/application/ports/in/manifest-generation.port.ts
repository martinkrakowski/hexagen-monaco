import type { GeneratedManifest } from "@hexagen/agentic-interaction";

export interface ManifestGenerationOptions {
  mode?: "local" | "server";
  modelId?: string;
}

export interface ManifestGenerationResult {
  ok: true;
  result: GeneratedManifest;
}

export interface ManifestGenerationError {
  ok: false;
  error: string;
}

export type ManifestGenerationResponse =
  | ManifestGenerationResult
  | ManifestGenerationError;

export interface ManifestGenerationPort {
  execute(
    description: string,
    options?: ManifestGenerationOptions,
  ): Promise<ManifestGenerationResponse>;
}
