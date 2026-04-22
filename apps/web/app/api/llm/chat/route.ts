import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth.js";
import { getServerLLMRequestPort } from "@/lib/wire.js";
import type { ServerLLMRequest } from "@hexagen/agentic-interaction";

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

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isRateLimited(session.user.email)) {
    return NextResponse.json(
      { error: "Too many requests. Please try again in a minute." },
      { status: 429 },
    );
  }

  let body: Partial<ServerLLMRequest>;
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

  try {
    const port = getServerLLMRequestPort();
    const stream = await port.handleRequest(
      { messages: body.messages },
      { id: session.user.email },
    );

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    // eslint-disable-next-line no-console -- intentional: route-level fallback diagnostic before returning 500
    console.error("[Server Chat] Error handling request:", error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
