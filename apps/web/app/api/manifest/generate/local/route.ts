/**
 * API endpoint for generating manifest.yaml using local LLM models when available
 * POST /api/manifest/generate/local
 */

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "../../../../../lib/rate-limiter";
import { enforceDailyQuota } from "../../../../../lib/enforce-quota";
import { GenerateManifestFromDescriptionUseCase } from "@hexagen/agentic-interaction";
import {
  createProjectDescription,
  type ProjectDescription,
} from "@hexagen/agentic-interaction";
import { isSameOrigin } from "../../../../lib/request-guards";
import { logger } from "../../../../../lib/structured-logger";
import {
  createGenerationTransactionManager,
  createLLMProviderSelector,
  createStage6ValidatorConfig,
  createWebLLMAdapter,
} from "../../../../lib/wire.server";

interface GenerateManifestRequestBody {
  description: string;
  language?: string;
  platform?: string;
  deployment?: string;
  additionalContext?: string;
  modelId?: string; // Added support for specific model ID selection
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
 * POST /api/manifest/generate/local
 * Generate a manifest.yaml file from a natural language project description
 * Using local LLM models when available with fallback to cloud
 */
export async function POST(
  request: NextRequest,
): Promise<NextResponse<GenerateManifestResponse>> {
  // Same-origin gate (D1), ahead of the rate limiter — see the sibling
  // /api/manifest/generate route. The wildcard-CORS preflight this family
  // carried is gone.
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { success: false, error: "Cross-origin request rejected" },
      { status: 403 },
    );
  }

  // Rate limiting
  const rateCheck = checkRateLimit(request, 10, 60 * 1000);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { success: false, error: "Rate limit exceeded" },
      {
        status: 429,
        headers: {
          "Retry-After": Math.ceil(rateCheck.retryAfter! / 1000).toString(),
        },
      },
    );
  }

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

  // Validate required fields before consuming quota — a malformed request must
  // not burn a unit or mint an orphan session.
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

  // Free-tier daily quota (per anonymous session). preferLocal can't run WebLLM
  // server-side, so this route falls back to the cloud chain — i.e. it consumes
  // the free-tier model and counts like any other generation.
  const quota = enforceDailyQuota(request, "generation");
  if (!quota.ok)
    return quota.response as NextResponse<GenerateManifestResponse>;

  try {
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

    // Dependencies come from the composition root (HEX-003). The WebLLM load,
    // the secret vault, the selector adapter's second hard-coded fallback chain
    // (openai → anthropic only, blind to the LLM_API_KEY / Inception providers
    // wire.server's chain carries) and the transaction manager were all built
    // here. Failure posture is unchanged: a WebLLM load error yields null and
    // the selector falls through to the cloud chain.
    const webLlmAdapter = await createWebLLMAdapter(body.modelId);

    const selectorAdapter = createLLMProviderSelector({
      webLlmAdapter,
      preferLocal: true,
      validateLocalLLM: true,
    });

    const transactionManager = createGenerationTransactionManager();

    // Create and execute use case
    logger.info(
      `[manifest-gen] API route: executing use case with model ${body.modelId || "default"}`,
    );
    // Dedicated Stage-6 reviewer (e.g. nemotron-3-ultra) — same as the
    // streaming routes, so this route isn't left on the main model when
    // STAGE6_VALIDATOR_API_KEY is set. Null ⇒ unchanged.
    const stage6Reviewer = createStage6ValidatorConfig();
    const useCase = new GenerateManifestFromDescriptionUseCase(
      selectorAdapter,
      transactionManager,
      stage6Reviewer ?? undefined,
    );
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
        { status: 500, headers: quota.headers },
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
      { status: 200, headers: quota.headers },
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
      { status: 500, headers: quota.headers },
    );
  }
}

// No OPTIONS handler — same-origin only; see the sibling /api/manifest/generate
// route for why the wildcard-CORS preflight was removed rather than narrowed.
