import { langGraphAdapter } from "../../../../src/infrastructure/langgraph";
import { streamGraphAsSse } from "../../../../src/infrastructure/langgraph/streaming/token-stream";

/**
 * POST /api/agent/stream
 *
 * Body: { prompt: string, threadId?: string, context?: string }
 * Returns: text/event-stream — one SSE event per node update, then a
 *          terminal `done` event. On failure, an `error` event with a
 *          short message before the stream closes.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      {
        status: 400,
        headers: { "content-type": "application/json" },
      },
    );
  }
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { prompt?: unknown }).prompt !== "string" ||
    ((body as { prompt: string }).prompt).length === 0
  ) {
    return new Response(
      JSON.stringify({ error: "`prompt` (non-empty string) is required" }),
      {
        status: 400,
        headers: { "content-type": "application/json" },
      },
    );
  }
  if (!langGraphAdapter.stream) {
    // Adapter built without streaming — surface clearly rather than 500ing.
    return new Response(
      JSON.stringify({ error: "Streaming is not enabled on this adapter" }),
      {
        status: 501,
        headers: { "content-type": "application/json" },
      },
    );
  }
  const { prompt, threadId, context } = body as {
    prompt: string;
    threadId?: string;
    context?: string;
  };
  const events = langGraphAdapter.stream({ prompt, threadId, context });
  return new Response(streamGraphAsSse(events), {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Disable nginx buffering so chunks reach the client immediately.
      "x-accel-buffering": "no",
    },
  });
}
