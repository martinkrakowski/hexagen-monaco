import { NextRequest } from "next/server";
import { checkRateLimit } from "../../../../../../lib/rate-limiter";
import { enforceDailyQuota } from "../../../../../../lib/enforce-quota";
import {
  ExecuteLooseSpecConversionUseCase,
  MAX_LOOSE_SPEC_INPUT_CHARS,
} from "@hexagen/agentic-interaction";
import { createLLMProviderSelector } from "../../../../../lib/wire.server";
import { logger } from "../../../../../../lib/structured-logger";

interface ConvertRequestBody {
  looseSpec: string;
  preferLocal?: boolean;
}

type NDJSONEvent =
  | { type: "chunk"; data: string }
  | { type: "progress"; message: string }
  | { type: "done"; configJson: string; config: unknown }
  | { type: "error"; message: string };

// How often to emit a liveness heartbeat while the model is working. The
// conversion can run for minutes; without periodic bytes the NDJSON stream is
// silent (reads as a crash to the user, and idle-connection proxies may drop
// it). Each tick also logs elapsed time for server-side telemetry.
const HEARTBEAT_INTERVAL_MS = 10_000;

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

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ type: "error", message: "Invalid JSON" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Guard: body must be a plain object. JSON.parse accepts null, arrays, and
  // primitives, all of which would throw on property access below.
  if (
    rawBody === null ||
    typeof rawBody !== "object" ||
    Array.isArray(rawBody)
  ) {
    return new Response(
      JSON.stringify({ type: "error", message: "Body must be a JSON object" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const body = rawBody as Partial<ConvertRequestBody>;

  if (typeof body.looseSpec !== "string" || body.looseSpec.length === 0) {
    return new Response(
      JSON.stringify({ type: "error", message: "Missing looseSpec" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (body.looseSpec.length > MAX_LOOSE_SPEC_INPUT_CHARS) {
    return new Response(
      JSON.stringify({
        type: "error",
        message: `Input too large (exceeds ${MAX_LOOSE_SPEC_INPUT_CHARS.toLocaleString()} characters).`,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Extract validated values so narrowing survives across the stream closure.
  const looseSpec = body.looseSpec;

  // Free-tier daily quota (per anonymous session) — consumed only after the
  // request is known valid, so malformed requests neither burn a unit nor mint
  // an orphan session. Per-IP check above is the burst backstop. Loose-spec
  // conversion is a cloud call, so it counts as a generation. Emitted in this
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

      const startedAt = Date.now();
      const heartbeat = setInterval(() => {
        try {
          const elapsedMs = Date.now() - startedAt;
          // elapsedMs is for server-side telemetry only — the client renders its
          // own per-second clock, so it is not sent on the wire.
          logger.info("Loose spec conversion in progress", {
            elapsedMs,
            elapsedSeconds: Math.round(elapsedMs / 1000),
          });
          send({
            type: "progress",
            message: "Model is processing your specification…",
          });
        } catch {
          // Best-effort: if the client disconnected, the stream is already
          // closing and `enqueue` throws — the finally below clears us shortly.
        }
      }, HEARTBEAT_INTERVAL_MS);

      try {
        const llmAdapter = createLLMProviderSelector({
          preferLocal: false,
          webLlmAdapter: null,
          validateLocalLLM: false,
        });

        const useCase = new ExecuteLooseSpecConversionUseCase(llmAdapter);

        const result = await useCase.execute(looseSpec, {
          signal: request.signal,
          onChunk: (chunk) => {
            send({ type: "chunk", data: chunk });
          },
        });

        if (result.success) {
          send({
            type: "done",
            configJson: result.value.configJson,
            config: result.value.config,
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
          logger.error("Loose spec conversion error:", { error });
        }
        send({
          type: "error",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        clearInterval(heartbeat);
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
