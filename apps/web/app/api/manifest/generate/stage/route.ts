import { NextRequest } from "next/server";
import { checkRateLimit } from "../../../../../lib/rate-limiter";
import {
  ExecuteStagedGenerationUseCase,
  type StagedGenerationCallbacks,
} from "@hexagen/agentic-interaction";
import type { PromptVariables } from "@hexagen/agentic-interaction";
import { createLLMProviderSelector } from "../../../../lib/wire.server";
import { logger } from "../../../../../lib/structured-logger";
import { InMemoryTransactionManager } from "@hexagen/transaction-system";

interface StageRequestBody {
  description: string;
  platform?: string;
  deployment?: string;
  additionalContext?: string;
  preferLocal?: boolean;
}

type NDJSONEvent =
  | { type: "stage-start"; stage: number; label: string }
  | { type: "stage-complete"; stage: number; label: string; durationMs: number }
  | {
      type: "stage-telemetry";
      stage: number;
      telemetry: Record<string, unknown>;
    }
  | { type: "chunk"; stage: number; data: string }
  | { type: "validation-error"; stage: number; errors: string[] }
  | {
      type: "done";
      yaml: string;
      contextCount: number;
      portCount: number;
      adapterCount: number;
      transactionId: string;
    }
  | { type: "error"; message: string };

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
      }
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
      const send = (event: NDJSONEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      const callbacks: StagedGenerationCallbacks = {
        onStageStart: (stage, label) =>
          send({ type: "stage-start", stage, label }),
        onStageComplete: (stage, label, durationMs) =>
          send({ type: "stage-complete", stage, label, durationMs }),
        onChunk: (stage, data) => send({ type: "chunk", stage, data }),
        onValidationError: (stage, errors) =>
          send({ type: "validation-error", stage, errors }),
        onStageTelemetry: (telemetry) =>
          send({
            type: "stage-telemetry",
            stage: telemetry.stage,
            telemetry: telemetry as unknown as Record<string, unknown>,
          }),
      };

      try {
        const llmAdapter = createLLMProviderSelector({
          preferLocal: body.preferLocal ?? false,
          webLlmAdapter: null,
          validateLocalLLM: false,
        });

        const transactionManager = new InMemoryTransactionManager();
        const useCase = new ExecuteStagedGenerationUseCase(
          llmAdapter,
          transactionManager,
        );

        const variables: PromptVariables = {
          userDescription: body.description,
          platform: body.platform,
          deployment: body.deployment,
          additionalContext: body.additionalContext,
        };

        const result = await useCase.execute(
          body.description,
          variables,
          callbacks,
        );

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
