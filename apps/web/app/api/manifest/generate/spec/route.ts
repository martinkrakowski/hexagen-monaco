import { NextRequest } from "next/server";
import { checkRateLimit } from "../../../../../lib/rate-limiter";
import {
  ExecuteStructuredConfigGenerationUseCase,
  ClassifyContextTypeUseCase,
  formatModelChip,
  type StructuredConfigGenerationCallbacks,
} from "@hexagen/agentic-interaction";
import { createLLMProviderSelector } from "../../../../lib/wire.server";
import { logger } from "../../../../../lib/structured-logger";
import { InMemoryTransactionManager } from "@hexagen/transaction-system";

interface SpecRequestBody {
  config: string;
  platform?: string;
  deployment?: string;
  additionalContext?: string;
  preferLocal?: boolean;
}

type NDJSONEvent =
  | { type: "stage-start"; stage: number; label?: string }
  | {
      type: "stage-complete";
      stage: number;
      label?: string;
      durationMs: number;
    }
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
      },
    );
  }

  let body: SpecRequestBody;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ type: "error", message: "Invalid JSON" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!body.config || typeof body.config !== "string") {
    return new Response(
      JSON.stringify({ type: "error", message: "Missing config" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: NDJSONEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      const callbacks: StructuredConfigGenerationCallbacks = {
        onProgress: (stage, _durationMs) => {
          // Omit label so the client uses its own STAGE_LABELS mapping
          // (e.g., "Port Mapping" instead of the generic "Stage 3").
          if (_durationMs === 0) {
            send({ type: "stage-start", stage });
          } else {
            send({
              type: "stage-complete",
              stage,
              durationMs: _durationMs,
            });
          }
        },
        onError: (stage, error) =>
          send({ type: "validation-error", stage, errors: [error] }),
        onChunk: (chunk) => send({ type: "chunk", stage: -1, data: chunk }),
        onStageTelemetry: (telemetry) => {
          // Per-stage observability: this route previously forwarded no
          // telemetry at all (nothing in the server log, nothing on the
          // wire), which is how a 5-minute client run could hide a 16s
          // server pipeline. Log it, forward the structured event, and
          // surface the serving model in the status stream.
          logger.info("[spec-gen] stage complete", {
            stage: telemetry.stage,
            label: telemetry.label,
            model: telemetry.modelName,
            refinerModel: telemetry.refinerModelName,
            durationMs: telemetry.durationMs,
            retryCount: telemetry.retryCount,
            inputTokensEstimate: telemetry.inputTokensEstimate,
            outputTokensActual: telemetry.outputTokensActual,
          });
          send({
            type: "stage-telemetry",
            stage: telemetry.stage,
            telemetry: telemetry as unknown as Record<string, unknown>,
          });
          const chip = formatModelChip(telemetry);
          if (chip) {
            const seconds = (telemetry.durationMs / 1000).toFixed(1);
            send({
              type: "chunk",
              stage: -1,
              data: `Stage ${telemetry.stage} · ${telemetry.label} — ${chip} · ${seconds}s`,
            });
          }
        },
      };

      try {
        const llmAdapter = createLLMProviderSelector({
          preferLocal: false,
          webLlmAdapter: null,
          validateLocalLLM: false,
        });

        const transactionManager = new InMemoryTransactionManager();
        const classifyUseCase = new ClassifyContextTypeUseCase(llmAdapter);
        // LLM_ESCALATION_MODEL is opt-in: only set this when you know the
        // configured provider (LLM_BASE_URL) hosts the named model. Setting
        // "gpt-4o" against a non-OpenAI endpoint produces 404s on retry.
        const escalationModel = process.env.LLM_ESCALATION_MODEL || undefined;
        const useCase = new ExecuteStructuredConfigGenerationUseCase(
          llmAdapter,
          transactionManager,
          classifyUseCase,
          escalationModel,
        );

        const result = await useCase.execute(body.config, callbacks);

        if (result.success) {
          const yaml = result.value.yaml || "";
          const parsed =
            (result.value.parsedObject as Record<string, unknown>) || {};
          const ctxCount = Array.isArray(parsed.bounded_contexts)
            ? parsed.bounded_contexts.length
            : 0;
          const portCount = Array.isArray(parsed.context_mappings)
            ? parsed.context_mappings.length
            : 0;
          const adapterCount = Array.isArray(parsed.bounded_contexts)
            ? (
                parsed.bounded_contexts as Array<Record<string, unknown>>
              ).reduce(
                (sum, ctx) =>
                  sum + (Array.isArray(ctx.adapters) ? ctx.adapters.length : 0),
                0,
              )
            : 0;

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
          logger.error("Structured config generation error:", { error });
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
      // Rate limit info for clients to understand endpoint constraints
      "X-RateLimit-Limit": process.env.LLM_RATE_LIMIT || "unlimited",
      "X-RateLimit-Window": "60s",
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
