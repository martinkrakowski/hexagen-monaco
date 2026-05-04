export const SSE_HEARTBEAT_INTERVAL_MS = 5_000;

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

export function formatSSEEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function formatSSEComment(comment: string): string {
  return `: ${comment}\n\n`;
}

export interface SSEStreamContext {
  readonly controller: ReadableStreamDefaultController;
  readonly encoder: TextEncoder;
  send(event: string, data: unknown): void;
  sendComment(comment: string): void;
  startHeartbeat(): ReturnType<typeof setInterval>;
}

export function createSSEResponse(
  start: (ctx: SSEStreamContext) => Promise<void>,
  extraHeaders?: Record<string, string>,
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const ctx: SSEStreamContext = {
        controller,
        encoder,
        send(event: string, data: unknown) {
          controller.enqueue(encoder.encode(formatSSEEvent(event, data)));
        },
        sendComment(comment: string) {
          controller.enqueue(encoder.encode(formatSSEComment(comment)));
        },
        startHeartbeat() {
          return setInterval(() => {
            try {
              controller.enqueue(encoder.encode(formatSSEComment("heartbeat")));
            } catch {
              // Stream already closed
            }
          }, SSE_HEARTBEAT_INTERVAL_MS);
        },
      };

      await start(ctx);
    },
  });

  return new Response(stream, {
    headers: { ...SSE_HEADERS, ...extraHeaders },
  });
}
