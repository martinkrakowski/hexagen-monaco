import { NextRequest } from "next/server";
import { checkRateLimit } from "../../../../../../lib/rate-limiter";
import {
  ExecuteLooseSpecConversionUseCase,
  MAX_LOOSE_SPEC_INPUT_CHARS,
} from "@hexagen/agentic-interaction";
import { createLLMProviderSelector } from "../../../../../lib/wire.server";
import { logger } from "../../../../../../lib/structured-logger";
import type { WebLLMAdapter } from "@hexagen/local-llm";

interface ConvertRequestBody {
  looseSpec: string;
  preferLocal?: boolean;
}

type NDJSONEvent =
  | { type: "chunk"; data: string }
  | { type: "done"; configJson: string; config: unknown }
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

  let body: ConvertRequestBody;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ type: "error", message: "Invalid JSON" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!body.looseSpec || typeof body.looseSpec !== "string") {
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

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: NDJSONEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      try {
        let webLlmAdapter: WebLLMAdapter | null = null;
        try {
          const { WebLLMAdapter: Adapter } = await import("@hexagen/local-llm");
          webLlmAdapter = new Adapter({
            defaultModelId: undefined,
          });
        } catch (error) {
          if (process.env.NODE_ENV !== "production") {
            logger.warn("WebLLM adapter initialization failed:", { error });
          }
        }

        const hasCloudKeys =
          !!process.env.OPENAI_API_KEY || !!process.env.ANTHROPIC_API_KEY;
        const preferLocal = body.preferLocal ?? !hasCloudKeys;

        const llmAdapter = createLLMProviderSelector({
          preferLocal,
          webLlmAdapter,
          validateLocalLLM: false,
        });

        const useCase = new ExecuteLooseSpecConversionUseCase(llmAdapter);

        const result = await useCase.execute(body.looseSpec, {
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
