// apps/web/app/api/architecture/modify/stream/route.ts
// SSE streaming endpoint for architecture modification pipeline
// Emits pipeline step progress events as they complete

import { NextRequest } from "next/server";
import path from "path";
import { getModifyArchitectureUseCase } from "@/lib/wire.server";
import { getLogger } from "@/lib/wire";
import type { IntentLineage } from "@hexagen/core-domain";

const SSE_HEARTBEAT_INTERVAL_MS = 5_000;

function validateManifestPath(rawPath: string): string {
  const cwd = process.cwd();
  const allowedBase = path.join(cwd, ".architecture");
  const resolvedPath = path.resolve(cwd, rawPath);

  if (
    !resolvedPath.startsWith(allowedBase + path.sep) &&
    resolvedPath !== allowedBase
  ) {
    throw new Error(
      `Invalid path: traversal detected. Path must be within .architecture directory.`,
    );
  }

  return resolvedPath;
}

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

  let manifestPath: string;
  try {
    manifestPath = validateManifestPath(
      body.manifestPath ?? ".architecture/manifest.yaml",
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Invalid manifest path";
    return new Response(
      `data: ${JSON.stringify({ type: "error", message })}\n\n`,
      { status: 400, headers: { "Content-Type": "text/event-stream" } },
    );
  }
  const lineage: IntentLineage = body.lineage ?? {
    intentId: `intent-${Date.now()}_v1`,
    origin: { type: "user", actorId: "api" },
    timestamp: Date.now(),
    targetContract: { mvkVersion: "1", rrpVersion: "1", remVersion: "1" },
    validation: { valid: true },
  };

  const abortSignal = request.signal;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
      let llmAbortController: AbortController | undefined;
      let isAborted = false;

      const send = (event: string, data: unknown) => {
        try {
          const serialized = JSON.stringify(data);
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${serialized}\n\n`),
          );
        } catch (err) {
          const logger = getLogger();
          logger.errorWithException(
            err,
            `[api/architecture/modify/stream] Failed to serialize SSE event: ${event}`,
          );

          try {
            controller.enqueue(
              encoder.encode(
                `event: pipeline_error\ndata: ${JSON.stringify({
                  error: "Internal serialization failure",
                })}\n\n`,
              ),
            );
          } catch {
            clearInterval(heartbeatTimer);
            controller.close();
          }
        }
      };

      const startHeartbeat = () => {
        heartbeatTimer = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          } catch {
            clearInterval(heartbeatTimer);
          }
        }, SSE_HEARTBEAT_INTERVAL_MS);
      };

      const stopLlmInference = () => {
        if (llmAbortController && !isAborted) {
          isAborted = true;
          llmAbortController.abort();
        }
      };

      const cleanup = () => {
        stopLlmInference();
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = undefined;
        }
      };

      try {
        startHeartbeat();

        const abortHandler = () => {
          cleanup();
          try {
            controller.close();
          } catch {
            // Stream already closed by client disconnect
          }
        };
        abortSignal.addEventListener("abort", abortHandler, { once: true });

        send("pipeline_start", { intent: body.intent });

        llmAbortController = new AbortController();

        let useCase;
        try {
          useCase = getModifyArchitectureUseCase(
            "in-memory",
            llmAbortController.signal,
            {
              onStepRunning: (name) => send("step_running", { name }),
              onStepComplete: (name, status, durationMs) =>
                send("step_complete", { name, status, durationMs }),
            },
          );
        } catch (err) {
          const logger = getLogger();
          logger.errorWithException(
            err,
            "[api/architecture/modify/stream] Use case wiring failed",
          );

          const message =
            err instanceof Error
              ? err.message
              : "Failed to initialize pipeline";
          send("pipeline_error", { error: message });
          cleanup();
          abortSignal.removeEventListener("abort", abortHandler);
          controller.close();
          return;
        }

        const result = await useCase.execute(
          body.intent,
          manifestPath,
          lineage,
        );

        if (result.success) {
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

        abortSignal.removeEventListener("abort", abortHandler);
      } catch (err) {
        const logger = getLogger();
        logger.errorWithException(
          err,
          "[api/architecture/modify/stream] Pipeline execution failed",
        );
        const message =
          err instanceof Error ? err.message : "Internal server error";
        send("pipeline_error", { error: message });
      } finally {
        cleanup();
        try {
          controller.close();
        } catch {
          // Stream already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
