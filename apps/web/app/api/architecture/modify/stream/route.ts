// apps/web/app/api/architecture/modify/stream/route.ts
// SSE streaming endpoint for architecture modification pipeline
// Emits pipeline step progress events as they complete

import { NextRequest } from "next/server";
import { getModifyArchitectureUseCase } from "@/lib/wire.architecture-modification";
import { getLogger } from "@/lib/wire";
import type { IntentLineage } from "@hexagen/core-domain";

interface StreamRequestBody {
  intent: string;
  manifestPath?: string;
  lineage?: IntentLineage;
}

export async function POST(request: NextRequest) {
  let body: StreamRequestBody;
  try {
    body = await request.json();
  } catch {
    return new Response(
      `data: ${JSON.stringify({ type: "error", message: "Invalid JSON" })}\n\n`,
      { status: 400, headers: { "Content-Type": "text/event-stream" } },
    );
  }

  if (!body.intent || typeof body.intent !== "string") {
    return new Response(
      `data: ${JSON.stringify({ type: "error", message: "'intent' must be a non-empty string." })}\n\n`,
      { status: 400, headers: { "Content-Type": "text/event-stream" } },
    );
  }

  const manifestPath = body.manifestPath ?? ".architecture/manifest.yaml";
  const lineage: IntentLineage = body.lineage ?? {
    intentId: `intent-${Date.now()}_v1`,
    origin: { type: "user", actorId: "api" },
    timestamp: Date.now(),
    targetContract: { mvkVersion: "1", rrpVersion: "1", remVersion: "1" },
    validation: { valid: true },
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        send("pipeline_start", { intent: body.intent });

        const stepNames = [
          "parse-nl-intent",
          "compile-prompt",
          "llm-inference",
          "reconcile",
          "commit-patches",
        ];
        for (const name of stepNames) {
          send("step_running", { name });
        }

        const useCase = getModifyArchitectureUseCase();
        const result = await useCase.execute(
          body.intent,
          manifestPath,
          lineage,
        );

        if (result.success) {
          for (const step of result.value.steps) {
            send("step_complete", {
              name: step.name,
              status: step.status,
              durationMs: step.endTime ? step.endTime - step.startTime : null,
            });
          }

          send("pipeline_complete", {
            pipelineRunId: result.value.pipelineRunId,
            patchesApplied: result.value.patchesApplied,
            lintPassed: result.value.lintPassed,
            transactionId: result.value.transactionId,
            patches: result.value.patches ?? [],
          });
        } else {
          send("pipeline_error", {
            error: result.error.message,
          });
        }
      } catch (err) {
        const logger = getLogger();
        logger.errorWithException(
          err,
          "[api/architecture/modify/stream] Failed",
        );
        const message =
          err instanceof Error ? err.message : "Internal server error";
        send("pipeline_error", { error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
