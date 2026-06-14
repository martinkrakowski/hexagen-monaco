import { NextRequest } from "next/server";
import { checkRateLimit } from "../../../../../lib/rate-limiter";
import { enforceDailyQuota } from "../../../../../lib/enforce-quota";
import { ExecuteFullStagedGenerationUseCase } from "@hexagen/agentic-interaction";
import type {
  PromptVariables,
  StageTelemetry,
} from "@hexagen/agentic-interaction";
import {
  createLLMProviderSelector,
  createStage1RefinerConfig,
} from "../../../../lib/wire.server";
import { logger } from "../../../../../lib/structured-logger";
import { InMemoryTransactionManager } from "@hexagen/transaction-system";
import {
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

  // Free-tier daily quota (per anonymous session); the per-IP check above is the
  // burst backstop. Formatted in this route's native ndjson error channel.
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

        const transactionManager = new InMemoryTransactionManager();

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
        const useCase = new ExecuteFullStagedGenerationUseCase(
          llmAdapter,
          transactionManager,
          stage1Refinement ? { stage1Refinement } : undefined,
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
          const yaml = result.state.stage5?.yaml || "";
          const ctxCount = result.state.stage2?.accepted.length ?? 0;
          const portCount =
            result.state.stage3?.contexts.reduce(
              (sum, c) => sum + c.in.length + c.out.length,
              0,
            ) ?? 0;
          const adapterCount =
            result.state.stage4?.contexts.reduce(
              (sum, c) => sum + c.adapters.length,
              0,
            ) ?? 0;

          send({
            type: "done",
            yaml,
            contextCount: ctxCount,
            portCount,
            adapterCount,
            transactionId: result.transactionId,
          });
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
      "Access-Control-Allow-Origin": "*",
      ...quota.headers,
    },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
