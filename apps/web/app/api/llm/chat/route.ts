import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth.js";
import { HandleServerChatUseCase } from "@hexagen/agentic-interaction";
import { createLLMProvider } from "@/lib/wire.shared";
import { getProxyRequestUseCase } from "@/lib/byok-wire.js";
import { SSE_HEADERS } from "@/lib/sse-helpers";
import type { ChatMessage } from "@hexagen/local-llm";
import type { ByokProvider } from "@hexagen/byok";

// --- Rate Limiter (In-Memory) ---
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10;
const userRequestTimestamps = new Map<string, number[]>();

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const timestamps = userRequestTimestamps.get(userId) || [];

  // Filter out timestamps older than the window
  const recentTimestamps = timestamps.filter(
    (ts) => now - ts < RATE_LIMIT_WINDOW_MS,
  );

  if (recentTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    return true; // Rate limited
  }

  // Add current request timestamp and update the map
  recentTimestamps.push(now);
  userRequestTimestamps.set(userId, recentTimestamps);
  return false;
}

interface ByokChatBody {
  messages: unknown[];
  byokCiphertext?: string;
  byokProvider?: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
}

const VALID_BYOK_PROVIDERS: ReadonlySet<string> = new Set([
  "openai",
  "anthropic",
  "cohere",
]);

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.sub;

  if (isRateLimited(userId)) {
    return NextResponse.json(
      { error: "Too many requests. Please try again in a minute." },
      { status: 429 },
    );
  }

  let body: ByokChatBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON in request body" },
      { status: 400 },
    );
  }

  if (
    !body.messages ||
    !Array.isArray(body.messages) ||
    body.messages.length === 0
  ) {
    return NextResponse.json(
      { error: "'messages' must be a non-empty array." },
      { status: 400 },
    );
  }

  const isByokRequest =
    typeof body.byokCiphertext === "string" &&
    typeof body.byokProvider === "string";

  if (isByokRequest) {
    if (!VALID_BYOK_PROVIDERS.has(body.byokProvider!)) {
      return NextResponse.json(
        { error: `Unsupported BYOK provider: ${body.byokProvider}` },
        { status: 400 },
      );
    }

    try {
      const byokPort = getProxyRequestUseCase();
      const result = await byokPort.streamExecute({
        ciphertext: body.byokCiphertext!,
        provider: body.byokProvider! as ByokProvider,
        payload: {
          messages: body.messages,
          model: body.model ?? "gpt-4o",
          stream: true,
          ...(body.temperature !== undefined && {
            temperature: body.temperature,
          }),
          ...(body.maxTokens !== undefined && { max_tokens: body.maxTokens }),
        },
        userId,
      });

      if (!result.success) {
        const status =
          result.error.kind === "key_revoked"
            ? 403
            : result.error.kind === "invalid_ciphertext"
              ? 400
              : 502;
        return NextResponse.json({ error: result.error.message }, { status });
      }

      return new Response(result.value.stream, {
        headers: {
          ...SSE_HEADERS,
          ...(result.value.rotatedCiphertext && {
            "X-Byok-Rotated-Ciphertext": result.value.rotatedCiphertext,
          }),
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "An unexpected error occurred.";
      // eslint-disable-next-line no-console -- intentional: route-level fallback diagnostic before returning 500
      console.error("[Server Chat] BYOK streaming error:", error);
      return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
  }

  try {
    const port = new HandleServerChatUseCase(
      createLLMProvider(),
      process.env.NEXT_PUBLIC_LLM_MODEL || "gpt-4o-mini",
    );
    const stream = await port.handleRequest(
      { messages: body.messages as ChatMessage[] },
      { id: userId },
    );

    return new Response(stream, {
      headers: { ...SSE_HEADERS },
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    // eslint-disable-next-line no-console -- intentional: route-level fallback diagnostic before returning 500
    console.error("[Server Chat] Error handling request:", error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
