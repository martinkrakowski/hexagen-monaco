import { NextRequest } from "next/server";
import { checkRateLimit } from "../../../../../lib/rate-limiter";
import { enforceDailyQuota } from "../../../../../lib/enforce-quota";
import { ExecuteFullStagedGenerationUseCase } from "@hexagen/agentic-interaction";
import type {
  PromptVariables,
  StageTelemetry,
} from "@hexagen/agentic-interaction";
import {
  createGenerationTransactionManager,
  createLLMProviderSelector,
  createStage1RefinerConfig,
  createStage6ValidatorConfig,
} from "../../../../lib/wire.server";
import { isSameOrigin } from "../../../../lib/request-guards";
import { logger } from "../../../../../lib/structured-logger";
import {
  buildDoneEvent,
  createFullPipelineEventAdapter,
  type StageRouteEvent,
} from "./pipeline-selection";

interface StageRequestBody {
  description: string;
  platform?: string;
  deployment?: string;
  additionalContext?: string;
  preferLocal?: boolean;
}

export async function POST(request: NextRequest) {
  // Same-origin gate (D1), ahead of the rate limiter. Emitted in this route's
  // native ndjson error channel so the client's stream reader sees a shaped
  // frame rather than an opaque body.
  if (!isSameOrigin(request)) {
    return new Response(
      JSON.stringify({
        type: "error",
        message: "Cross-origin request rejected",
      }) + "\n",
      { status: 403, headers: { "Content-Type": "application/x-ndjson" } },
    );
  }

  // Rate limiting
  const rateCheck = checkRateLimit(request, 10, 60 * 1000);
  if (!rateCheck.allowed) {
    const retryAfter = Math.ceil(rateCheck.retryAfter! / 1000);
    return new Response(
      JSON.stringify({ type: "error", message: "Rate limit exceeded" }) + "\n",
      {
        status: 429,
        headers: {
          "Content-Type": "application/x-ndjson",
          "Retry-After": retryAfter.toString(),
        },
      },
    );
  }

  let body: StageRequestBody;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ type: "error", message: "Invalid JSON" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!body.description || typeof body.description !== "string") {
    return new Response(
      JSON.stringify({ type: "error", message: "Missing description" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Free-tier daily quota (per anonymous session) — consumed only after the
  // request is known valid, so malformed requests neither burn a unit nor mint
  // an orphan session. Per-IP check above is the burst backstop. Emitted in this
  // route's native ndjson error channel.
  const quota = enforceDailyQuota(request, "generation");
  if (!quota.ok) {
    return new Response(
      JSON.stringify({ type: "error", message: quota.message }) + "\n",
      {
        status: 429,
        headers: {
          "Content-Type": "application/x-ndjson",
          "Retry-After": String(quota.retryAfterSeconds),
          ...quota.headers,
        },
      },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: StageRouteEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      try {
        const llmAdapter = createLLMProviderSelector({
          preferLocal: body.preferLocal ?? false,
          webLlmAdapter: null,
          validateLocalLLM: false,
        });

        // HEX-003: from the composition root, not `new`-ed here.
        const transactionManager = createGenerationTransactionManager();

        const variables: PromptVariables = {
          userDescription: body.description,
          platform: body.platform,
          deployment: body.deployment,
          additionalContext: body.additionalContext,
        };

        // Per-stage server log with model identity — keyed off the same
        // telemetry the client receives, so the two can be cross-checked.
        const logStageTelemetry = (telemetry: StageTelemetry) => {
          logger.info("[staged-gen] stage complete", {
            stage: telemetry.stage,
            label: telemetry.label,
            model: telemetry.modelName,
            refinerModel: telemetry.refinerModelName,
            durationMs: telemetry.durationMs,
            retryCount: telemetry.retryCount,
            inputTokensEstimate: telemetry.inputTokensEstimate,
            outputTokensActual: telemetry.outputTokensActual,
          });
        };

        // A4: the full 0→6 pipeline is the only pipeline (the stub + the
        // STAGED_GENERATION_PIPELINE/FULL_PERCENT selection seam are gone).
        // Stage-1 draft→refine cascade — null (off) unless
        // STAGE1_REFINER_API_KEY is set; see createStage1RefinerConfig.
        const stage1Refinement = createStage1RefinerConfig();
        if (stage1Refinement) {
          logger.info("[staged-gen] stage-1 refiner active", {
            mode: stage1Refinement.mode,
          });
        }
        // Dedicated Stage-6 validation reviewer (e.g. nemotron-3-ultra). Null
        // unless STAGE6_VALIDATOR_API_KEY is set — review stays on the main
        // pipeline model at 800, unchanged.
        const stage6Reviewer = createStage6ValidatorConfig();
        const useCase = new ExecuteFullStagedGenerationUseCase(
          llmAdapter,
          transactionManager,
          {
            ...(stage1Refinement ? { stage1Refinement } : {}),
            ...(stage6Reviewer ? { stage6Reviewer } : {}),
          },
        );
        const eventAdapter = createFullPipelineEventAdapter(send);
        const result = await useCase.execute(body.description, variables, {
          ...eventAdapter,
          onStageTelemetry: (telemetry) => {
            logStageTelemetry(telemetry);
            eventAdapter.onStageTelemetry?.(telemetry);
          },
        });

        if (result.success) {
          // Counts + the Stage-6 `validation` report (previously dropped by
          // this route — /spec surfaced it, /stage didn't) are built in one
          // tested helper; see buildDoneEvent in pipeline-selection.ts.
          send(buildDoneEvent(result.state, result.transactionId));
        } else {
          const msg =
            result.error instanceof Error
              ? result.error.message
              : String(result.error);
          send({ type: "error", message: msg });
        }
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          logger.error("Staged generation error:", { error });
        }
        send({
          type: "error",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...quota.headers,
    },
  });
}

// No OPTIONS handler — same-origin only; see the sibling /api/manifest/generate
// route for why the wildcard-CORS preflight was removed rather than narrowed.
