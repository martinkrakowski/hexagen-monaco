/**
 * API endpoint for generating manifest.yaml from natural language descriptions
 * POST /api/manifest/generate
 */

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "../../../../lib/rate-limiter";
import { enforceDailyQuota } from "../../../../lib/enforce-quota";
import { GenerateManifestFromDescriptionUseCase } from "@hexagen/agentic-interaction";
import {
  createProjectDescription,
  type ProjectDescription,
} from "@hexagen/agentic-interaction";
import { isSameOrigin } from "../../../lib/request-guards";
import { logger } from "../../../../lib/structured-logger";
import {
  createGenerationTransactionManager,
  createLLMProviderSelector,
  createStage6ValidatorConfig,
} from "../../../lib/wire.server";

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
  // Same-origin gate (D1), ahead of the rate limiter — the same composition
  // #443 established for app/api/architecture/. This endpoint spends the
  // caller's daily generation quota and drives a paid LLM chain, so a
  // cross-origin page must not be able to burn it. The wildcard-CORS block that
  // used to invite exactly that (and the OPTIONS preflight that advertised it)
  // is gone; the route is same-origin only.
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

  // Free-tier daily quota (per anonymous session). The per-IP check above is the
  // burst backstop; this is the durable daily cap.
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

    // Dependencies come from the composition root (HEX-003). This route used
    // to `new` its own secret vault, selector adapter and transaction manager,
    // and carried a SECOND hard-coded fallback chain (openai → anthropic only)
    // that could not see the LLM_API_KEY / Inception providers wire.server's
    // chain has carried since the mercury flip.
    //
    // `webLlmAdapter: null` is not a downgrade: WebLLM is a browser runtime and
    // the block this replaces was guarded by `typeof window !== "undefined"`,
    // which is never true inside a route handler — it always left the adapter
    // null.
    const preferLocal =
      body.preferLocal === undefined ? false : body.preferLocal;

    const llmAdapter = createLLMProviderSelector({
      webLlmAdapter: null,
      preferLocal, // Use cloud by default for backward compatibility
      validateLocalLLM: true,
    });

    const transactionManager = createGenerationTransactionManager();

    // Create and execute use case
    // Dedicated Stage-6 reviewer (e.g. nemotron-3-ultra) — same as the
    // streaming routes, so this cloud-default route isn't left on the main
    // model when STAGE6_VALIDATOR_API_KEY is set. Null ⇒ unchanged.
    const stage6Reviewer = createStage6ValidatorConfig();
    const useCase = new GenerateManifestFromDescriptionUseCase(
      llmAdapter,
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

// No OPTIONS handler: the route is same-origin only, and a same-origin fetch
// never preflights. The handler that used to live here answered every preflight
// with `Access-Control-Allow-Origin: *`, which is what made this endpoint
// callable from any page on the internet.
