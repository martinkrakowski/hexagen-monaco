import { NextRequest } from "next/server";
import {
  ExecuteStructuredConfigGenerationUseCase,
  type StructuredConfigGenerationCallbacks,
} from "@hexagen/agentic-interaction";
import { createLLMProviderSelector } from "../../../../lib/wire.server";
import { logger } from "../../../../../lib/structured-logger";

interface SpecRequestBody {
  config: string;
  platform?: string;
  deployment?: string;
  additionalContext?: string;
  preferLocal?: boolean;
}

type NDJSONEvent =
  | { type: "stage-start"; stage: number; label: string }
  | { type: "stage-complete"; stage: number; label: string; durationMs: number }
  | { type: "chunk"; stage: number; data: string }
  | { type: "validation-error"; stage: number; errors: string[] }
  | {
      type: "done";
      yaml: string;
      contextCount: number;
      portCount: number;
      adapterCount: number;
    }
  | { type: "error"; message: string };

export async function POST(request: NextRequest) {
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
          if (_durationMs === 0) {
            send({ type: "stage-start", stage, label: `Stage ${stage}` });
          } else {
            send({
              type: "stage-complete",
              stage,
              label: `Stage ${stage}`,
              durationMs: _durationMs,
            });
          }
        },
        onError: (stage, error) =>
          send({ type: "validation-error", stage, errors: [error] }),
        onChunk: (chunk) => send({ type: "chunk", stage: -1, data: chunk }),
      };

      try {
        const llmAdapter = createLLMProviderSelector({
          preferLocal: body.preferLocal ?? false,
          webLlmAdapter: null,
          validateLocalLLM: false,
        });

        const useCase = new ExecuteStructuredConfigGenerationUseCase(
          llmAdapter,
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
