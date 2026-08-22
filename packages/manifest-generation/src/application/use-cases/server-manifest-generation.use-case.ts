import type { ManifestGenerationPort } from "../ports/in/manifest-generation.port.js";
import type { GeneratedManifest } from "@hexagen/agentic-interaction";

interface ServerGeneratedManifest {
  manifest: string;
  confidence: number;
  suggestions: string[];
  warnings: string[];
  metadata: {
    model: string;
    processingTime: number;
    tokensUsed: number;
    provider?: string;
  };
}

interface ServerGenerationResponse {
  success: true;
  manifest: string;
  confidence: number;
  suggestions: string[];
  warnings: string[];
  metadata: {
    model: string;
    processingTime: number;
    tokensUsed: number;
    provider: string;
  };
}

interface ServerErrorResponse {
  success: false;
  error: string;
  details?: string;
}

type ServerResponse = ServerGenerationResponse | ServerErrorResponse;

export class ServerManifestGenerationUseCase implements ManifestGenerationPort {
  async execute(
    description: string,
    options?: { mode?: "local" | "server"; modelId?: string },
  ): Promise<
    { ok: true; result: GeneratedManifest } | { ok: false; error: string }
  > {
    try {
      const endpoint =
        options?.mode === "local"
          ? "/api/manifest/generate/local"
          : "/api/manifest/generate";

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          description,
          modelId: options?.modelId,
        }),
      });

      let data: ServerResponse;
      try {
        data = (await response.json()) as ServerResponse;
      } catch {
        return {
          ok: false,
          error: "Invalid response from server",
        };
      }

      if (!response.ok || !data.success) {
        const errorResponse = data as ServerErrorResponse;
        return {
          ok: false,
          error: errorResponse.error || "Failed to generate manifest",
        };
      }

      const serverData = data as ServerGenerationResponse;
      const generatedManifest: GeneratedManifest = {
        manifest: serverData.manifest,
        confidence: serverData.confidence,
        suggestions: serverData.suggestions,
        warnings: serverData.warnings,
        metadata: {
          model: serverData.metadata.model,
          processingTime: serverData.metadata.processingTime,
          tokensUsed: serverData.metadata.tokensUsed,
          provider: serverData.metadata.provider,
        },
      };

      return {
        ok: true,
        result: generatedManifest,
      };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }
}
