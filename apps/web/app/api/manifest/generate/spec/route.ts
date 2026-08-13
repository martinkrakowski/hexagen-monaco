import { NextRequest } from "next/server";
import { checkRateLimit } from "../../../../../lib/rate-limiter";
import { enforceDailyQuota } from "../../../../../lib/enforce-quota";
import {
  ExecuteStructuredConfigGenerationUseCase,
  ClassifyContextTypeUseCase,
  formatModelChip,
  type StructuredConfigGenerationCallbacks,
} from "@hexagen/agentic-interaction";
import {
  createLLMProviderSelector,
  createStage6ReviewerConfig,
  createStage6ValidatorConfig,
} from "../../../../lib/wire.server";
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
  // Early manifest (Part B-lite): emitted once, right after Stage-5 assembly,
  // while the Stage-6 review (and optional Stage-7 repair) is still running.
  // NON-terminal — `done` always follows and its yaml supersedes this one.
  // transactionId is "" here: the transaction is only begun AFTER the review
  // passes, so no id exists yet; the real id arrives on `done`.
  | {
      type: "manifest";
      yaml: string;
      contextCount: number;
      portCount: number;
      adapterCount: number;
      transactionId: string;
    }
  | {
      type: "done";
      yaml: string;
      contextCount: number;
      portCount: number;
      adapterCount: number;
      transactionId: string;
      // Stage-6 review findings on the (successfully produced) manifest —
      // advisory, surfaced so the UI can show them instead of just a count.
      validation: { errors: string[]; warnings: string[]; passed: boolean };
      // Stage-7 verify-and-repair outcome — present only when the reviewer was
      // configured AND Stage 6 found errors. Counts let the UI report
      // "repaired K of N" honestly.
      repair?: {
        attempted: boolean;
        applied: boolean;
        errorsBefore: number;
        errorsAfter: number;
        warningsBefore: number;
        warningsAfter: number;
      };
    }
  | { type: "error"; message: string };

// Shared by the early `manifest` frame and the terminal `done` frame so the
// two can never disagree on how counts are derived. NOTE: portCount reads
// context_mappings — the historical wire contract of this route (predates the
// layered-ports layout); kept as-is to avoid changing what `done` reports.
function countsFromParsed(parsed: Record<string, unknown>): {
  contextCount: number;
  portCount: number;
  adapterCount: number;
} {
  const contextCount = Array.isArray(parsed.bounded_contexts)
    ? parsed.bounded_contexts.length
    : 0;
  const portCount = Array.isArray(parsed.context_mappings)
    ? parsed.context_mappings.length
    : 0;
  const adapterCount = Array.isArray(parsed.bounded_contexts)
    ? (parsed.bounded_contexts as Array<unknown>).reduce<number>((sum, ctx) => {
        // A bare `-` YAML list item parses to null — counting must never
        // throw on LLM-produced yaml (same posture as countManifestEntities),
        // so non-object entries contribute zero instead of crashing the
        // stream (review fix).
        if (ctx === null || typeof ctx !== "object") return sum;
        const adapters = (ctx as Record<string, unknown>).adapters;
        return sum + (Array.isArray(adapters) ? adapters.length : 0);
      }, 0)
    : 0;
  return { contextCount, portCount, adapterCount };
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
        onManifestReady: (manifest) => {
          // Part B-lite: surface the Stage-5 manifest while Stage 6/7 run.
          send({
            type: "manifest",
            yaml: manifest.yaml || "",
            ...countsFromParsed(
              (manifest.parsedObject as Record<string, unknown>) || {},
            ),
            // No transaction exists until the review completes — see the
            // NDJSONEvent comment. The client ignores this field anyway.
            transactionId: "",
          });
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
        // Stage-7 verify-and-repair reviewer (gpt-4o). Null unless
        // STAGE6_REVIEWER_API_KEY is set — a Martin-gated prod secret; when
        // absent the orchestrator skips repair and behaves exactly as before.
        const reviewerPort = createStage6ReviewerConfig();
        // Dedicated Stage-6 validation reviewer (e.g. nemotron-3-ultra). Null
        // unless STAGE6_VALIDATOR_API_KEY is set — review then stays on the main
        // pipeline model at 800, unchanged.
        const stage6Reviewer = createStage6ValidatorConfig();
        const useCase = new ExecuteStructuredConfigGenerationUseCase(
          llmAdapter,
          transactionManager,
          classifyUseCase,
          escalationModel,
          reviewerPort ?? undefined,
          stage6Reviewer ?? undefined,
        );

        const result = await useCase.execute(body.config, callbacks);

        if (result.success) {
          const yaml = result.value.yaml || "";
          const parsed =
            (result.value.parsedObject as Record<string, unknown>) || {};
          const { contextCount, portCount, adapterCount } =
            countsFromParsed(parsed);

          send({
            type: "done",
            yaml,
            contextCount,
            portCount,
            adapterCount,
            transactionId: result.transactionId,
            validation: result.validation,
            ...(result.repair ? { repair: result.repair } : {}),
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
