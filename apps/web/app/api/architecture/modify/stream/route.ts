// apps/web/app/api/architecture/modify/stream/route.ts
// SSE streaming endpoint for architecture modification pipeline
// Emits pipeline step progress events as they complete

import { NextRequest } from "next/server";
import path from "path";
import {
  getModifyArchitectureUseCase,
  findMonorepoRoot,
  MonorepoRootNotFoundError,
} from "@/lib/wire.server";
import { createWebLogger } from "@/lib/wire.shared";
import { guardMutation } from "@/lib/request-guards";
import {
  createSSEResponse,
  formatSSEComment,
  formatSSEEvent,
  SSE_HEARTBEAT_INTERVAL_MS,
} from "@/lib/sse-helpers";
import type { IntentLineage } from "@hexagen/core-domain";

function validateManifestPath(rawPath: string): string {
  // Anchor path resolution + the traversal gate at the monorepo root — the same anchor the mutation/lint adapters use (findMonorepoRoot), NOT process.cwd() (which is apps/web in prod).
  const cwd = findMonorepoRoot();
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
  // Same-origin + rate-limit gate (D1): runs the full modify pipeline (LLM +
  // manifest mutation), so gate before opening the SSE stream. A rejected
  // request gets a plain JSON 403/429 rather than an event stream.
  const gate = guardMutation(request);
  if (gate) return gate;

  let body: StreamRequestBody;
  try {
    body = await request.json();
  } catch {
    return new Response(
      `data: ${JSON.stringify({ type: "error", success: false, error: "Invalid JSON" })}\n\n`,
      { status: 400, headers: { "Content-Type": "text/event-stream" } },
    );
  }

  if (!body.intent || typeof body.intent !== "string") {
    return new Response(
      `data: ${JSON.stringify({ type: "error", success: false, error: "'intent' must be a non-empty string." })}\n\n`,
      { status: 400, headers: { "Content-Type": "text/event-stream" } },
    );
  }

  let manifestPath: string;
  try {
    manifestPath = validateManifestPath(
      body.manifestPath ?? ".architecture/manifest.yaml",
    );
  } catch (err) {
    // A missing on-disk manifest anchor is a server config failure, not bad
    // client input — surface it as 5xx (and log) so monitoring sees it, rather
    // than masking it as a 400. Only path-traversal input yields 400 below.
    if (err instanceof MonorepoRootNotFoundError) {
      const logger = createWebLogger();
      // Full detail (incl. the process.cwd() path) goes to the SERVER LOG only;
      // the SSE error frame carries the stable, path-free client message. The
      // raw err.message embeds the server filesystem path, which must never
      // reach a client-facing error frame regardless of CORS (CWE-209).
      logger.errorWithException(
        err,
        "[api/architecture/modify/stream] Manifest root not found",
      );
      return new Response(
        `data: ${JSON.stringify({ type: "error", success: false, error: MonorepoRootNotFoundError.clientMessage })}\n\n`,
        { status: 500, headers: { "Content-Type": "text/event-stream" } },
      );
    }
    const message =
      err instanceof Error ? err.message : "Invalid manifest path";
    return new Response(
      `data: ${JSON.stringify({ type: "error", success: false, error: message })}\n\n`,
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

  return createSSEResponse(async (ctx) => {
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let llmAbortController: AbortController | undefined;
    let isAborted = false;

    const send = (event: string, data: unknown) => {
      try {
        ctx.controller.enqueue(ctx.encoder.encode(formatSSEEvent(event, data)));
      } catch (err) {
        const logger = createWebLogger();
        logger.errorWithException(
          err,
          `[api/architecture/modify/stream] Failed to serialize SSE event: ${event}`,
        );

        try {
          ctx.controller.enqueue(
            ctx.encoder.encode(
              formatSSEEvent("pipeline_error", {
                success: false,
                error: "Internal serialization failure",
              }),
            ),
          );
        } catch {
          clearInterval(heartbeatTimer);
          ctx.controller.close();
        }
      }
    };

    const startHeartbeat = () => {
      heartbeatTimer = setInterval(() => {
        try {
          ctx.controller.enqueue(
            ctx.encoder.encode(formatSSEComment("heartbeat")),
          );
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
          ctx.controller.close();
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
        const logger = createWebLogger();
        logger.errorWithException(
          err,
          "[api/architecture/modify/stream] Use case wiring failed",
        );

        const message =
          err instanceof Error ? err.message : "Failed to initialize pipeline";
        send("pipeline_error", { success: false, error: message });
        cleanup();
        abortSignal.removeEventListener("abort", abortHandler);
        ctx.controller.close();
        return;
      }

      const result = await useCase.execute(body.intent, manifestPath, lineage);

      if (result.success) {
        send("pipeline_complete", {
          success: true,
          pipelineRunId: result.value.pipelineRunId,
          patchesApplied: result.value.patchesApplied,
          lintPassed: result.value.lintPassed,
          transactionId: result.value.transactionId,
          patches: result.value.patches ?? [],
        });
      } else {
        send("pipeline_error", {
          success: false,
          error: result.error.message,
        });
      }

      abortSignal.removeEventListener("abort", abortHandler);
    } catch (err) {
      const logger = createWebLogger();
      logger.errorWithException(
        err,
        "[api/architecture/modify/stream] Pipeline execution failed",
      );
      const message =
        err instanceof Error ? err.message : "Internal server error";
      send("pipeline_error", { success: false, error: message });
    } finally {
      cleanup();
      try {
        ctx.controller.close();
      } catch {
        // Stream already closed
      }
    }
  });
}
