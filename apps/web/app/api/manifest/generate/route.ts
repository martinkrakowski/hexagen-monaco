/**
 * API endpoint for generating manifest.yaml from natural language descriptions
 * POST /api/manifest/generate
 */

import { NextRequest, NextResponse } from "next/server";
import { GenerateManifestFromDescriptionUseCase } from "@hexagen/agentic-interaction";
import {
  createProjectDescription,
  type ProjectDescription,
} from "@hexagen/agentic-interaction";
import { LLMProviderSelectorAdapter } from "@hexagen/agentic-interaction";
import { EnvironmentSecretVaultAdapter } from "@hexagen/agentic-interaction";
import type { WebLLMAdapter } from "@hexagen/local-llm";
import { logger } from "../../../../lib/structured-logger";

interface GenerateManifestRequestBody {
  description: string;
  language?: string;
  platform?: string;
  deployment?: string;
  additionalContext?: string;
  preferLocal?: boolean;
  modelId?: string;
}

interface GenerateManifestSuccessResponse {
  success: true;
  manifest: string;
  confidence: number;
  suggestions: string[];
  warnings: string[];
  generationWarnings?: Array<{
    category: string;
    context?: string;
    message: string;
    suggestedAction: string;
  }>;
  diagnostics?: {
    totalAttempts: number;
    tokensUsed: number;
    processingTime: number;
    repairApplied: boolean;
    model: string;
  };
  metadata: {
    model: string;
    processingTime: number;
    tokensUsed: number;
    provider: string;
  };
}

interface GenerateManifestErrorResponse {
  success: false;
  error: string;
  details?: string;
}

type GenerateManifestResponse =
  | GenerateManifestSuccessResponse
  | GenerateManifestErrorResponse;

/**
 * POST /api/manifest/generate
 * Generate a manifest.yaml file from a natural language project description
 */
export async function POST(
  request: NextRequest,
): Promise<NextResponse<GenerateManifestResponse>> {
  let body: GenerateManifestRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid JSON in request body",
      },
      { status: 400 },
    );
  }

  try {
    // Validate required fields
    if (!body.description || typeof body.description !== "string") {
      return NextResponse.json(
        {
          success: false,
          error: "Missing or invalid description field",
          details: 'Request body must include a "description" string field',
        },
        { status: 400 },
      );
    }

    // Create project description value object
    let projectDescription: ProjectDescription;
    try {
      projectDescription = createProjectDescription(body.description, {
        language: body.language,
        platform: body.platform,
        deployment: body.deployment,
        additionalContext: body.additionalContext,
      });
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid project description",
          details: error instanceof Error ? error.message : "Validation failed",
        },
        { status: 400 },
      );
    }

    // Wire up dependencies
    const secretVault = new EnvironmentSecretVaultAdapter();

    let webLlmAdapter: WebLLMAdapter | null = null;
    try {
      if (typeof window !== "undefined") {
        const { WebLLMAdapter: Adapter } = await import("@hexagen/local-llm");
        webLlmAdapter = new Adapter({});
      }
    } catch (error) {
      logger.warn("WebLLM adapter initialization failed:", { error });
    }

    // Configure the fallback chain for cloud providers
    const fallbackChain = {
      primary: {
        providerId: "openai" as const,
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o",
        apiKeyEnvVar: "OPENAI_API_KEY",
        temperature: 0.3,
        maxTokens: 4000,
      },
      fallbacks: [
        {
          providerId: "anthropic" as const,
          baseUrl: "https://api.anthropic.com/v1",
          model: "claude-3-5-sonnet-20241022",
          apiKeyEnvVar: "ANTHROPIC_API_KEY",
          temperature: 0.3,
          maxTokens: 4000,
        },
      ],
    };

    // Configure LLM provider selector with preference option from request
    const preferLocal =
      body.preferLocal === undefined ? false : body.preferLocal;

    // Create the selector adapter
    const llmAdapter = new LLMProviderSelectorAdapter({
      webLlmAdapter,
      preferLocal, // Use cloud by default for backward compatibility
      validateLocalLLM: true,
      fallbackChain,
      secretVault,
    });

    // Create and execute use case
    const useCase = new GenerateManifestFromDescriptionUseCase(llmAdapter);
    const result = await useCase.execute({
      description: projectDescription,
    });

    // Handle use case result
    if (!result.success || !result.manifest) {
      return NextResponse.json(
        {
          success: false,
          error: result.error || "Failed to generate manifest",
          details:
            "The LLM was unable to generate a valid manifest from the description",
        },
        { status: 500 },
      );
    }

    // Return successful response
    return NextResponse.json(
      {
        success: true,
        manifest: result.manifest.manifest,
        confidence: result.manifest.confidence,
        suggestions: result.manifest.suggestions,
        warnings: result.manifest.warnings,
        generationWarnings: result.warnings?.map((w) => ({
          category: w.category,
          context: w.context,
          message: w.message,
          suggestedAction: w.suggestedAction,
        })),
        diagnostics: result.diagnostics,
        metadata: {
          model: result.manifest.metadata.model,
          processingTime: result.manifest.metadata.processingTime,
          tokensUsed: result.manifest.metadata.tokensUsed,
          provider: result.manifest.metadata.provider || "unknown",
        },
      },
      { status: 200 },
    );
  } catch (error) {
    // Error logging (not for production)
    if (process.env.NODE_ENV !== "production") {
      logger.error("Error generating manifest:", { error });
    }

    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
        details:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred",
      },
      { status: 500 },
    );
  }
}

/**
 * OPTIONS /api/manifest/generate
 * Handle CORS preflight requests
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

// Made with Bob
