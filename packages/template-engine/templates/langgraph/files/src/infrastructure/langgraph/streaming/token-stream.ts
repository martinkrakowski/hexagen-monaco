import type { GraphEvent } from "../../../domain/ports/out/agent-graph.port";

/**
 * Server-Sent Events encoder for a graph's `AsyncIterable<GraphEvent>`.
 * Each event is serialised as a single SSE `data:` frame with a heartbeat
 * comment line every ~15s so intermediate proxies don't drop an idle
 * stream (Cloudflare, Vercel edges, etc.).
 *
 * Usage from a Next.js route:
 *
 *   const stream = streamGraphAsSse(adapter.stream(input));
 *   return new Response(stream, {
 *     headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
 *   });
 */
const HEARTBEAT_INTERVAL_MS = 15_000;
const encoder = new TextEncoder();

export function streamGraphAsSse(
  events: AsyncIterable<GraphEvent>,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          // Controller closed (client disconnected); the for-await loop
          // below will throw next iteration and we'll clean up there.
        }
      }, HEARTBEAT_INTERVAL_MS);
      try {
        for await (const evt of events) {
          const frame = `event: ${evt.type}\ndata: ${JSON.stringify(evt.data)}\n\n`;
          controller.enqueue(encoder.encode(frame));
        }
        controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const frame = `event: error\ndata: ${JSON.stringify({ message })}\n\n`;
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          // Best-effort error frame; if the controller is gone, drop it.
        }
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
    },
  });
}
