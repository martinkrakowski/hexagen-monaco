import { NextRequest, NextResponse } from "next/server";
import { OpenAICompatibleAdapter } from "@hexagen/agentic-interaction";
import { getCloudProvider } from "@/config/cloud-providers";

interface ChatRequestBody {
  messages: Array<{ role: string; content: string }>;
  provider: string;
  model: string;
  apiKey: string;
  temperature?: number;
  maxTokens?: number;
}

function validateRequestBody(body: unknown):
  | {
      valid: true;
      data: ChatRequestBody;
    }
  | {
      valid: false;
      error: string;
    } {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Request body must be a JSON object" };
  }

  const b = body as Record<string, unknown>;

  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    return { valid: false, error: "messages must be a non-empty array" };
  }

  if (typeof b.provider !== "string" || !b.provider) {
    return { valid: false, error: "provider must be a non-empty string" };
  }

  if (typeof b.model !== "string" || !b.model) {
    return { valid: false, error: "model must be a non-empty string" };
  }

  if (typeof b.apiKey !== "string" || !b.apiKey) {
    return { valid: false, error: "apiKey must be a non-empty string" };
  }

  for (const msg of b.messages as Array<unknown>) {
    const m = msg as Record<string, unknown>;
    if (
      typeof m.role !== "string" ||
      !["system", "user", "assistant"].includes(m.role) ||
      typeof m.content !== "string"
    ) {
      return {
        valid: false,
        error:
          "Each message must have role (system|user|assistant) and content (string)",
      };
    }
  }

  return {
    valid: true,
    data: {
      messages: b.messages as ChatRequestBody["messages"],
      provider: b.provider,
      model: b.model,
      apiKey: b.apiKey,
      temperature:
        typeof b.temperature === "number" ? b.temperature : undefined,
      maxTokens: typeof b.maxTokens === "number" ? b.maxTokens : undefined,
    },
  };
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON in request body" },
      { status: 400 },
    );
  }

  const validation = validateRequestBody(body);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { messages, provider, model, apiKey, temperature, maxTokens } =
    validation.data;

  const providerConfig = getCloudProvider(provider);
  if (!providerConfig) {
    return NextResponse.json(
      { error: `Unknown provider: ${provider}` },
      { status: 400 },
    );
  }

  if (!providerConfig.available) {
    return NextResponse.json(
      {
        error: `Provider "${providerConfig.displayName}" is not yet available`,
      },
      { status: 400 },
    );
  }

  const adapter = new OpenAICompatibleAdapter(
    apiKey,
    providerConfig.baseUrl,
    model,
  );

  const stream = adapter.streamComplete({
    model,
    messages: messages as Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }>,
    temperature,
    maxTokens,
  });

  const encoder = new TextEncoder();

  const readableStream = new ReadableStream({
    async start(controller) {
      try {
        for await (const result of stream) {
          if (result.success) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "chunk", content: result.value })}\n\n`,
              ),
            );
          } else {
            const errorMsg =
              result.error instanceof Error
                ? result.error.message
                : String(result.error);
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "error", message: errorMsg })}\n\n`,
              ),
            );
            break;
          }
        }
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`),
        );
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", message: errorMsg })}\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readableStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
